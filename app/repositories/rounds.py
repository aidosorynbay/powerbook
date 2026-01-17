from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.round import Round
from app.repositories.base import BaseRepository


class RoundRepository(BaseRepository[Round]):
    def __init__(self, db: Session) -> None:
        super().__init__(db)

    def get(self, round_id: uuid.UUID) -> Round | None:
        return self.db.get(Round, round_id)

    def get_by_group_year_month(self, *, group_id: uuid.UUID, year: int, month: int) -> Round | None:
        stmt = select(Round).where(
            Round.group_id == group_id,
            Round.year == year,
            Round.month == month,
        )
        return self.db.execute(stmt).scalar_one_or_none()

    def list_for_group(
        self,
        *,
        group_id: uuid.UUID,
        offset: int = 0,
        limit: int = 50,
    ) -> list[Round]:
        stmt = (
            select(Round)
            .where(Round.group_id == group_id)
            .offset(offset)
            .limit(limit)
            .order_by(Round.year.desc(), Round.month.desc())
        )
        return list(self.db.execute(stmt).scalars().all())

    def create(
        self,
        *,
        group_id: uuid.UUID,
        year: int,
        month: int,
        timezone: str = "UTC",
        registration_open_until_day: int = 10,
    ) -> Round:
        rnd = Round(
            group_id=group_id,
            year=year,
            month=month,
            timezone=timezone,
            registration_open_until_day=registration_open_until_day,
        )
        self.db.add(rnd)
        self.db.commit()
        self.db.refresh(rnd)
        return rnd

