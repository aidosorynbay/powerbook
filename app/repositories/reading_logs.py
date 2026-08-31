from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.enums import RoundParticipantStatus
from app.models.reaction import ReadingLogReaction
from app.models.round import ReadingLog, RoundParticipant
from app.models.user import User
from app.repositories.base import BaseRepository


# A day counts once it reaches this many minutes. The round's final day is
# correction-only and scores nothing regardless — see resync_scores.
MIN_SCORING_MINUTES = 30


def score_for(minutes: int) -> int:
    return 1 if minutes >= MIN_SCORING_MINUTES else 0


class ReadingLogRepository(BaseRepository[ReadingLog]):
    def __init__(self, db: Session) -> None:
        super().__init__(db)

    def get(self, reading_log_id: uuid.UUID) -> ReadingLog | None:
        return self.db.get(ReadingLog, reading_log_id)

    def get_for_user_date(
        self,
        *,
        round_id: uuid.UUID,
        user_id: uuid.UUID,
        day: date,
    ) -> ReadingLog | None:
        stmt = select(ReadingLog).where(
            ReadingLog.round_id == round_id,
            ReadingLog.user_id == user_id,
            ReadingLog.date == day,
        )
        return self.db.execute(stmt).scalar_one_or_none()

    def list_for_user(
        self,
        *,
        round_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> list[ReadingLog]:
        stmt = (
            select(ReadingLog)
            .where(ReadingLog.round_id == round_id, ReadingLog.user_id == user_id)
            .order_by(ReadingLog.date.asc())
        )
        return list(self.db.execute(stmt).scalars().all())

    def list_for_user_rounds(
        self,
        *,
        round_ids: list[uuid.UUID],
        user_ids: list[uuid.UUID],
    ) -> list[ReadingLog]:
        if not round_ids or not user_ids:
            return []
        stmt = (
            select(ReadingLog)
            .where(ReadingLog.round_id.in_(round_ids), ReadingLog.user_id.in_(user_ids))
            .order_by(ReadingLog.date.asc())
        )
        return list(self.db.execute(stmt).scalars().all())

    def aggregate_scores_by_user(
        self,
        *,
        round_id: uuid.UUID,
        day_from: date | None = None,
        day_to: date | None = None,
    ) -> dict[uuid.UUID, int]:
        # Same window rule as the leaderboard: for a mini-round, only days
        # inside the round's slice of the month count toward final results.
        window = [ReadingLog.round_id == round_id]
        if day_from is not None:
            window.append(ReadingLog.date >= day_from)
        if day_to is not None:
            window.append(ReadingLog.date <= day_to)
        stmt = (
            select(ReadingLog.user_id, func.coalesce(func.sum(ReadingLog.score), 0).label("total_score"))
            .where(*window)
            .group_by(ReadingLog.user_id)
        )
        return {row.user_id: int(row.total_score) for row in self.db.execute(stmt).all()}

    def total_minutes_for_user(self, *, round_id: uuid.UUID, user_id: uuid.UUID) -> int:
        stmt = (
            select(func.coalesce(func.sum(ReadingLog.minutes), 0))
            .where(ReadingLog.round_id == round_id, ReadingLog.user_id == user_id)
        )
        return int(self.db.execute(stmt).scalar())

    def leaderboard_data(
        self,
        *,
        round_id: uuid.UUID,
        day_from: date | None = None,
        day_to: date | None = None,
    ) -> list[dict]:
        participants_stmt = (
            select(RoundParticipant.user_id, User.display_name, User.telegram_id)
            .join(User, RoundParticipant.user_id == User.id)
            .where(
                RoundParticipant.round_id == round_id,
                RoundParticipant.status == RoundParticipantStatus.active,
            )
        )
        participants = {row.user_id: (row.display_name, row.telegram_id) for row in self.db.execute(participants_stmt).all()}

        # A mini-round only scores its own slice of the month, so logs left
        # over from days outside the window must not count toward the board.
        window = [ReadingLog.round_id == round_id]
        if day_from is not None:
            window.append(ReadingLog.date >= day_from)
        if day_to is not None:
            window.append(ReadingLog.date <= day_to)

        scores_stmt = (
            select(
                ReadingLog.user_id.label("user_id"),
                func.coalesce(func.sum(ReadingLog.score), 0).label("total_score"),
                func.coalesce(func.sum(ReadingLog.score), 0).label("days_read"),
            )
            .where(*window)
            .group_by(ReadingLog.user_id)
        )
        scores = {row.user_id: (int(row.total_score), int(row.days_read)) for row in self.db.execute(scores_stmt).all()}

        result = []
        for user_id, (display_name, telegram_id) in participants.items():
            total_score, days_read = scores.get(user_id, (0, 0))
            result.append({
                "user_id": str(user_id),
                "display_name": display_name,
                "telegram_id": telegram_id,
                "total_score": total_score,
                "days_read": days_read,
            })
        return result

    def resync_scores(self, *, round_id: uuid.UUID, last_day: date, day_from: date) -> int:
        """Re-derive `score` for a round's logs and return how many changed.

        `score` is written once, at log time. That is fine until the round's
        own window moves: extending August from the 30th to the 31st meant the
        30th stopped being the correction day, but rows already written on the
        30th kept the 0 they were given. Anyone who logged the same day after
        the change got a 1, which is how the staleness surfaced.

        Rather than make every read recompute, this puts the values back in
        agreement with the rule on demand — notably before results are frozen.
        """
        rows = self.db.execute(
            select(ReadingLog).where(
                ReadingLog.round_id == round_id,
                ReadingLog.date >= day_from,
                ReadingLog.date <= last_day,
            )
        ).scalars().all()

        changed = 0
        for row in rows:
            want = 0 if row.date == last_day else score_for(row.minutes)
            if row.score != want:
                row.score = want
                changed += 1
        if changed:
            self.db.flush()
        return changed

    def upsert_minutes(
        self,
        *,
        round_id: uuid.UUID,
        user_id: uuid.UUID,
        day: date,
        minutes: int,
        force_score: int | None = None,
        book_finished: bool = False,
        comment: str | None = None,
        comment_private: bool = False,
    ) -> ReadingLog:
        score = force_score if force_score is not None else score_for(minutes)
        existing = self.get_for_user_date(round_id=round_id, user_id=user_id, day=day)
        if existing is None:
            row = ReadingLog(round_id=round_id, user_id=user_id, date=day, minutes=minutes)
            row.score = score
            row.book_finished = book_finished
            row.comment = comment
            row.is_comment_private = comment_private
            self.db.add(row)
        else:
            existing.minutes = minutes
            existing.score = score
            existing.book_finished = book_finished
            existing.comment = comment
            existing.is_comment_private = comment_private
            row = existing

        self.db.commit()
        self.db.refresh(row)
        return row

    def roster_for_round(self, *, round_id: uuid.UUID) -> list[tuple]:
        """Every logged day this circle, with who logged it — for the
        shared/group calendar. Private comments are redacted here so callers
        never see them, not just the API response."""
        return self.roster_for_rounds(round_ids=[round_id])

    def roster_for_rounds(self, *, round_ids: list[uuid.UUID]) -> list[tuple]:
        """Same as roster_for_round but across many circles at once — used
        by the shared/public archive view."""
        if not round_ids:
            return []
        stmt = (
            select(
                ReadingLog.date,
                ReadingLog.user_id,
                User.display_name,
                User.telegram_id,
                ReadingLog.minutes,
                ReadingLog.score,
                ReadingLog.book_finished,
                ReadingLog.comment,
                ReadingLog.is_comment_private,
            )
            .join(User, ReadingLog.user_id == User.id)
            .where(ReadingLog.round_id.in_(round_ids))
            .order_by(ReadingLog.date.asc())
        )
        rows = []
        for d, uid, name, tg, minutes, score, book_finished, comment, is_private in self.db.execute(stmt).all():
            rows.append((
                d, uid, name, tg, int(minutes), int(score), bool(book_finished),
                None if is_private else comment,
            ))
        return rows

    def toggle_reaction(self, *, reading_log_id: uuid.UUID, user_id: uuid.UUID, emoji: str = "🔥") -> bool:
        stmt = select(ReadingLogReaction).where(
            ReadingLogReaction.reading_log_id == reading_log_id,
            ReadingLogReaction.user_id == user_id,
        )
        existing = self.db.execute(stmt).scalar_one_or_none()
        if existing is not None:
            self.db.delete(existing)
            self.db.commit()
            return False
        row = ReadingLogReaction(reading_log_id=reading_log_id, user_id=user_id, emoji=emoji)
        self.db.add(row)
        self.db.commit()
        return True

    def reaction_summary(self, *, reading_log_id: uuid.UUID, user_id: uuid.UUID) -> dict:
        count_stmt = select(func.count(ReadingLogReaction.id)).where(
            ReadingLogReaction.reading_log_id == reading_log_id
        )
        count = int(self.db.execute(count_stmt).scalar() or 0)

        mine_stmt = select(ReadingLogReaction.id).where(
            ReadingLogReaction.reading_log_id == reading_log_id,
            ReadingLogReaction.user_id == user_id,
        )
        reacted = self.db.execute(mine_stmt).scalar_one_or_none() is not None
        return {"count": count, "reacted_by_me": reacted}
