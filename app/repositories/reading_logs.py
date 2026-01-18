from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.round import ReadingLog
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

    def upsert_minutes(
        self,
        *,
        round_id: uuid.UUID,
        user_id: uuid.UUID,
        day: date,
        minutes: int,
    ) -> ReadingLog:
        existing = self.get_for_user_date(round_id=round_id, user_id=user_id, day=day)
        if existing is None:
            row = ReadingLog(round_id=round_id, user_id=user_id, date=day, minutes=minutes)
            self.db.add(row)
        else:
            existing.minutes += minutes
            if existing.minutes > 30:
                existing.score = 1
            row = existing

        self.db.commit()
        self.db.refresh(row)
        return row

