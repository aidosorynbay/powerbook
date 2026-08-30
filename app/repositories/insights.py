from __future__ import annotations

import re
import uuid
from collections import defaultdict

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.claim import UsernameClaim
from app.models.manual_book import ManualBook
from app.models.enums import ClaimStatus, RoundParticipantStatus
from app.models.round import ReadingLog, Round, RoundParticipant, RoundResult
from app.models.user import User
from app.repositories.base import BaseRepository

_TRAILING_ASIDE_RE = re.compile(r"\s*[\(\[][^\(\)\[\]]*[\)\]]\s*$")
_WRAP_QUOTES = "'\"«»“”‘’"


def normalize_book_title(raw: str) -> str:
    """Collapse free-text variation in a finished-book comment down to a
    comparable title, so matching (Reading Twins, Celebrity Match) isn't
    defeated by an appended aside or reaction-thread noise that two people
    who read the same book happened to phrase differently.

    - Only the first line is ever the title; anything after a newline is
      commentary or (for older bulk-imported rows) raw threaded-reaction text.
    - Trailing parenthetical/bracketed asides ("(second time)", "(екінші рет
      оқу нәсіп болды)") are stripped, repeatedly, since they're asides, not
      part of the title.
    - Wrapping quote characters and internal whitespace runs are normalized.
    """
    text = raw.strip().split("\n", 1)[0].strip()
    while True:
        stripped = _TRAILING_ASIDE_RE.sub("", text)
        if stripped == text:
            break
        text = stripped.strip()
    text = text.strip(_WRAP_QUOTES).strip()
    return re.sub(r"\s+", " ", text).lower()


class InsightsRepository(BaseRepository[None]):
    def __init__(self, db: Session) -> None:
        super().__init__(db)

    def all_logged_dates(self, *, user_ids: list[uuid.UUID]) -> list:
        stmt = (
            select(ReadingLog.date)
            .where(ReadingLog.user_id.in_(user_ids), ReadingLog.score == 1)
            .order_by(ReadingLog.date.asc())
        )
        return [row[0] for row in self.db.execute(stmt).all()]

    def total_minutes_all_time(self, *, user_ids: list[uuid.UUID]) -> int:
        stmt = select(func.coalesce(func.sum(ReadingLog.minutes), 0)).where(ReadingLog.user_id.in_(user_ids))
        return int(self.db.execute(stmt).scalar() or 0)

    def total_days_logged(self, *, user_ids: list[uuid.UUID]) -> int:
        stmt = select(func.count(ReadingLog.id)).where(ReadingLog.user_id.in_(user_ids), ReadingLog.minutes > 0)
        return int(self.db.execute(stmt).scalar() or 0)

    def rounds_participated_count(self, *, user_ids: list[uuid.UUID]) -> int:
        stmt = select(func.count(func.distinct(RoundParticipant.round_id))).where(RoundParticipant.user_id.in_(user_ids))
        return int(self.db.execute(stmt).scalar() or 0)

    def first_round_for_user(self, *, user_ids: list[uuid.UUID]) -> Round | None:
        stmt = (
            select(Round)
            .join(RoundParticipant, RoundParticipant.round_id == Round.id)
            .where(RoundParticipant.user_id.in_(user_ids))
            .order_by(Round.year.asc(), Round.month.asc())
            .limit(1)
        )
        return self.db.execute(stmt).scalar_one_or_none()

    def finished_books_for_user(self, *, user_ids: list[uuid.UUID]) -> list[tuple[str, object, Round]]:
        stmt = (
            select(ReadingLog.comment, ReadingLog.date, Round)
            .join(Round, Round.id == ReadingLog.round_id)
            .where(
                ReadingLog.user_id.in_(user_ids),
                ReadingLog.book_finished.is_(True),
                ReadingLog.comment.is_not(None),
            )
            .order_by(ReadingLog.date.asc())
        )
        return [(row[0], row[1], row[2]) for row in self.db.execute(stmt).all()]

    def manual_books_for_user(self, *, user_ids: list[uuid.UUID]) -> list[ManualBook]:
        stmt = (
            select(ManualBook)
            .where(ManualBook.user_id.in_(user_ids))
            .order_by(ManualBook.finished_on.desc().nullslast(), ManualBook.created_at.desc())
        )
        return list(self.db.execute(stmt).scalars().all())

    def manual_book_by_id(self, *, book_id: uuid.UUID, user_ids: list[uuid.UUID]) -> ManualBook | None:
        stmt = select(ManualBook).where(ManualBook.id == book_id, ManualBook.user_id.in_(user_ids))
        return self.db.execute(stmt).scalar_one_or_none()

    def finished_book_titles_for_user(self, *, user_ids: list[uuid.UUID]) -> set[str]:
        stmt = select(ReadingLog.comment).where(
            ReadingLog.user_id.in_(user_ids),
            ReadingLog.book_finished.is_(True),
            ReadingLog.comment.is_not(None),
        )
        return {normalize_book_title(row[0]) for row in self.db.execute(stmt).all() if row[0]}

    def all_users_finished_books(self, *, exclude_user_ids: list[uuid.UUID] | None = None) -> dict[uuid.UUID, set[str]]:
        stmt = select(ReadingLog.user_id, ReadingLog.comment).where(
            ReadingLog.book_finished.is_(True),
            ReadingLog.comment.is_not(None),
        )
        exclude = set(exclude_user_ids or [])
        by_user: dict[uuid.UUID, set[str]] = defaultdict(set)
        for user_id, comment in self.db.execute(stmt).all():
            if user_id in exclude:
                continue
            if comment:
                by_user[user_id].add(normalize_book_title(comment))
        return dict(by_user)

    def popular_books(self, *, limit: int = 10) -> list[tuple[str, int]]:
        # Group by normalized title, not the raw comment — free-text variation
        # (an appended aside, reaction-thread noise, a quoted vs. unquoted
        # title) would otherwise split one book's finishers across several
        # rows and undercount every title. Each group keeps its most common
        # raw spelling as the display title.
        stmt = select(ReadingLog.user_id, ReadingLog.comment).where(
            ReadingLog.book_finished.is_(True), ReadingLog.comment.is_not(None)
        )
        readers_by_norm: dict[str, set[uuid.UUID]] = defaultdict(set)
        raw_counts_by_norm: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        for user_id, comment in self.db.execute(stmt).all():
            if not comment:
                continue
            norm = normalize_book_title(comment)
            readers_by_norm[norm].add(user_id)
            raw_counts_by_norm[norm][comment.strip()] += 1

        ranked = sorted(readers_by_norm.items(), key=lambda kv: -len(kv[1]))[:limit]
        return [
            (max(raw_counts_by_norm[norm].items(), key=lambda kv: kv[1])[0], len(readers))
            for norm, readers in ranked
        ]

    def display_name_and_telegram(self, *, user_id: uuid.UUID) -> tuple[str, str | None] | None:
        stmt = select(User.display_name, User.telegram_id).where(User.id == user_id)
        row = self.db.execute(stmt).first()
        return (row[0], row[1]) if row else None

    def round_by_id(self, *, round_id: uuid.UUID) -> Round | None:
        return self.db.get(Round, round_id)

    def scores_for_round(self, *, round_id: uuid.UUID) -> dict[uuid.UUID, int]:
        stmt = (
            select(ReadingLog.user_id, func.coalesce(func.sum(ReadingLog.score), 0))
            .where(ReadingLog.round_id == round_id)
            .group_by(ReadingLog.user_id)
        )
        return {row[0]: int(row[1]) for row in self.db.execute(stmt).all()}

    def last_participated_round(self, *, user_ids: list[uuid.UUID]) -> Round | None:
        stmt = (
            select(Round)
            .join(RoundParticipant, RoundParticipant.round_id == Round.id)
            .where(RoundParticipant.user_id.in_(user_ids))
            .order_by(Round.year.desc(), Round.month.desc())
            .limit(1)
        )
        return self.db.execute(stmt).scalar_one_or_none()

    def minutes_by_month_for_year(self, *, user_ids: list[uuid.UUID], year: int) -> dict[int, int]:
        stmt = (
            select(Round.month, func.coalesce(func.sum(ReadingLog.minutes), 0))
            .join(Round, Round.id == ReadingLog.round_id)
            .where(ReadingLog.user_id.in_(user_ids), Round.year == year)
            .group_by(Round.month)
        )
        return {row[0]: int(row[1]) for row in self.db.execute(stmt).all()}

    def daily_minutes_all_time(self, *, user_ids: list[uuid.UUID]) -> list[tuple[object, int]]:
        stmt = (
            select(ReadingLog.date, ReadingLog.minutes)
            .where(ReadingLog.user_id.in_(user_ids))
            .order_by(ReadingLog.date.asc())
        )
        return [(row[0], int(row[1])) for row in self.db.execute(stmt).all()]

    def round_label(self, rnd: Round) -> str:
        months = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        return f"{months[rnd.month]} {rnd.year}"

    # ---------- hall of fame (public, platform-wide) ----------

    def all_users_with_flags(self) -> dict[uuid.UUID, tuple[str, str | None, bool]]:
        """id -> (display_name, telegram_id, is_claimable)"""
        stmt = select(User.id, User.display_name, User.telegram_id, User.is_claimable)
        return {row[0]: (row[1], row[2], row[3]) for row in self.db.execute(stmt).all()}

    def minutes_by_all_users(self) -> dict[uuid.UUID, int]:
        stmt = select(ReadingLog.user_id, func.coalesce(func.sum(ReadingLog.minutes), 0)).group_by(ReadingLog.user_id)
        return {row[0]: int(row[1]) for row in self.db.execute(stmt).all()}

    def rounds_count_by_all_users(self) -> dict[uuid.UUID, int]:
        stmt = select(
            RoundParticipant.user_id, func.count(func.distinct(RoundParticipant.round_id))
        ).group_by(RoundParticipant.user_id)
        return {row[0]: int(row[1]) for row in self.db.execute(stmt).all()}

    def books_count_by_all_users(self) -> dict[uuid.UUID, int]:
        stmt = (
            select(ReadingLog.user_id, func.count(func.distinct(ReadingLog.comment)))
            .where(ReadingLog.book_finished.is_(True), ReadingLog.comment.is_not(None))
            .group_by(ReadingLog.user_id)
        )
        return {row[0]: int(row[1]) for row in self.db.execute(stmt).all()}

    def logged_dates_by_all_users(self) -> dict[uuid.UUID, list]:
        stmt = select(ReadingLog.user_id, ReadingLog.date).where(ReadingLog.score == 1)
        out: dict[uuid.UUID, list] = defaultdict(list)
        for uid, d in self.db.execute(stmt).all():
            out[uid].append(d)
        return dict(out)

    def all_approved_claims(self) -> dict[uuid.UUID, uuid.UUID]:
        """ghost_user_id -> claimant_user_id, approved only"""
        stmt = select(UsernameClaim.ghost_user_id, UsernameClaim.claimant_user_id).where(
            UsernameClaim.status == ClaimStatus.approved
        )
        return {row[0]: row[1] for row in self.db.execute(stmt).all()}

    def all_reading_rows(self) -> list[tuple[uuid.UUID, object, int, uuid.UUID]]:
        """(user_id, date, minutes, round_id) for every logged day, platform-wide."""
        stmt = select(ReadingLog.user_id, ReadingLog.date, ReadingLog.minutes, ReadingLog.round_id)
        return [(row[0], row[1], row[2], row[3]) for row in self.db.execute(stmt).all()]

    def all_rounds(self) -> list[Round]:
        return list(self.db.execute(select(Round)).scalars().all())

