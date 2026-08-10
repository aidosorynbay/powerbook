from __future__ import annotations

import uuid
from collections import defaultdict

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.enums import RoundParticipantStatus
from app.models.round import ReadingLog, Round, RoundParticipant, RoundResult
from app.models.user import User
from app.repositories.base import BaseRepository


class InsightsRepository(BaseRepository[None]):
    def __init__(self, db: Session) -> None:
        super().__init__(db)

    def all_logged_dates(self, *, user_id: uuid.UUID) -> list:
        stmt = (
            select(ReadingLog.date)
            .where(ReadingLog.user_id == user_id, ReadingLog.score == 1)
            .order_by(ReadingLog.date.asc())
        )
        return [row[0] for row in self.db.execute(stmt).all()]

    def total_minutes_all_time(self, *, user_id: uuid.UUID) -> int:
        stmt = select(func.coalesce(func.sum(ReadingLog.minutes), 0)).where(ReadingLog.user_id == user_id)
        return int(self.db.execute(stmt).scalar() or 0)

    def total_days_logged(self, *, user_id: uuid.UUID) -> int:
        stmt = select(func.count(ReadingLog.id)).where(ReadingLog.user_id == user_id, ReadingLog.minutes > 0)
        return int(self.db.execute(stmt).scalar() or 0)

    def rounds_participated_count(self, *, user_id: uuid.UUID) -> int:
        stmt = select(func.count(RoundParticipant.id)).where(RoundParticipant.user_id == user_id)
        return int(self.db.execute(stmt).scalar() or 0)

    def first_round_for_user(self, *, user_id: uuid.UUID) -> Round | None:
        stmt = (
            select(Round)
            .join(RoundParticipant, RoundParticipant.round_id == Round.id)
            .where(RoundParticipant.user_id == user_id)
            .order_by(Round.year.asc(), Round.month.asc())
            .limit(1)
        )
        return self.db.execute(stmt).scalar_one_or_none()

    def finished_books_for_user(self, *, user_id: uuid.UUID) -> list[tuple[str, object, Round]]:
        stmt = (
            select(ReadingLog.comment, ReadingLog.date, Round)
            .join(Round, Round.id == ReadingLog.round_id)
            .where(
                ReadingLog.user_id == user_id,
                ReadingLog.book_finished.is_(True),
                ReadingLog.comment.is_not(None),
            )
            .order_by(ReadingLog.date.asc())
        )
        return [(row[0], row[1], row[2]) for row in self.db.execute(stmt).all()]

    def finished_book_titles_for_user(self, *, user_id: uuid.UUID) -> set[str]:
        stmt = select(ReadingLog.comment).where(
            ReadingLog.user_id == user_id,
            ReadingLog.book_finished.is_(True),
            ReadingLog.comment.is_not(None),
        )
        return {row[0].strip().lower() for row in self.db.execute(stmt).all() if row[0]}

    def all_users_finished_books(self, *, exclude_user_id: uuid.UUID | None = None) -> dict[uuid.UUID, set[str]]:
        stmt = select(ReadingLog.user_id, ReadingLog.comment).where(
            ReadingLog.book_finished.is_(True),
            ReadingLog.comment.is_not(None),
        )
        by_user: dict[uuid.UUID, set[str]] = defaultdict(set)
        for user_id, comment in self.db.execute(stmt).all():
            if exclude_user_id is not None and user_id == exclude_user_id:
                continue
            if comment:
                by_user[user_id].add(comment.strip().lower())
        return dict(by_user)

    def popular_books(self, *, limit: int = 10) -> list[tuple[str, int]]:
        stmt = (
            select(ReadingLog.comment, func.count(func.distinct(ReadingLog.user_id)).label("n"))
            .where(ReadingLog.book_finished.is_(True), ReadingLog.comment.is_not(None))
            .group_by(ReadingLog.comment)
            .order_by(func.count(func.distinct(ReadingLog.user_id)).desc())
            .limit(limit)
        )
        return [(row[0], int(row[1])) for row in self.db.execute(stmt).all()]

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

    def last_participated_round(self, *, user_id: uuid.UUID) -> Round | None:
        stmt = (
            select(Round)
            .join(RoundParticipant, RoundParticipant.round_id == Round.id)
            .where(RoundParticipant.user_id == user_id)
            .order_by(Round.year.desc(), Round.month.desc())
            .limit(1)
        )
        return self.db.execute(stmt).scalar_one_or_none()

    def minutes_by_month_for_year(self, *, user_id: uuid.UUID, year: int) -> dict[int, int]:
        stmt = (
            select(Round.month, func.coalesce(func.sum(ReadingLog.minutes), 0))
            .join(Round, Round.id == ReadingLog.round_id)
            .where(ReadingLog.user_id == user_id, Round.year == year)
            .group_by(Round.month)
        )
        return {row[0]: int(row[1]) for row in self.db.execute(stmt).all()}

    def daily_minutes_all_time(self, *, user_id: uuid.UUID) -> list[tuple[object, int]]:
        stmt = (
            select(ReadingLog.date, ReadingLog.minutes)
            .where(ReadingLog.user_id == user_id)
            .order_by(ReadingLog.date.asc())
        )
        return [(row[0], int(row[1])) for row in self.db.execute(stmt).all()]

    def round_label(self, rnd: Round) -> str:
        months = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        return f"{months[rnd.month]} {rnd.year}"
