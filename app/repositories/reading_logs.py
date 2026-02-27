from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.enums import RoundParticipantStatus
from app.models.round import ReadingLog, RoundParticipant
from app.models.user import User
from app.repositories.base import BaseRepository


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
        user_id: uuid.UUID,
    ) -> list[ReadingLog]:
        if not round_ids:
            return []
        stmt = (
            select(ReadingLog)
            .where(ReadingLog.round_id.in_(round_ids), ReadingLog.user_id == user_id)
            .order_by(ReadingLog.date.asc())
        )
        return list(self.db.execute(stmt).scalars().all())

    def aggregate_scores_by_user(self, *, round_id: uuid.UUID) -> dict[uuid.UUID, int]:
        stmt = (
            select(ReadingLog.user_id, func.coalesce(func.sum(ReadingLog.score), 0).label("total_score"))
            .where(ReadingLog.round_id == round_id)
            .group_by(ReadingLog.user_id)
        )
        return {row.user_id: int(row.total_score) for row in self.db.execute(stmt).all()}

    def leaderboard_data(
        self, *, round_id: uuid.UUID
    ) -> list[dict]:
        participants_stmt = (
            select(RoundParticipant.user_id, User.display_name)
            .join(User, RoundParticipant.user_id == User.id)
            .where(
                RoundParticipant.round_id == round_id,
                RoundParticipant.status == RoundParticipantStatus.active,
            )
        )
        participants = {row.user_id: row.display_name for row in self.db.execute(participants_stmt).all()}

        scores_stmt = (
            select(
                ReadingLog.user_id.label("user_id"),
                func.coalesce(func.sum(ReadingLog.score), 0).label("total_score"),
                func.coalesce(func.sum(ReadingLog.score), 0).label("days_read"),
            )
            .where(ReadingLog.round_id == round_id)
            .group_by(ReadingLog.user_id)
        )
        scores = {row.user_id: (int(row.total_score), int(row.days_read)) for row in self.db.execute(scores_stmt).all()}

        result = []
        for user_id, display_name in participants.items():
            total_score, days_read = scores.get(user_id, (0, 0))
            result.append({
                "user_id": str(user_id),
                "display_name": display_name,
                "total_score": total_score,
                "days_read": days_read,
            })
        return result

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
    ) -> ReadingLog:
        score = force_score if force_score is not None else (1 if minutes >= 30 else 0)
        existing = self.get_for_user_date(round_id=round_id, user_id=user_id, day=day)
        if existing is None:
            row = ReadingLog(round_id=round_id, user_id=user_id, date=day, minutes=minutes)
            row.score = score
            row.book_finished = book_finished
            row.comment = comment
            self.db.add(row)
        else:
            existing.minutes = minutes
            existing.score = score
            existing.book_finished = book_finished
            existing.comment = comment
            row = existing

        self.db.commit()
        self.db.refresh(row)
        return row

