from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.round import RoundResult
from app.models.user import User
from app.repositories.base import BaseRepository


class RoundResultRepository(BaseRepository[RoundResult]):
    def __init__(self, db: Session) -> None:
        super().__init__(db)

    def list_for_round(self, *, round_id: uuid.UUID) -> list[RoundResult]:
        stmt = select(RoundResult).where(RoundResult.round_id == round_id).order_by(RoundResult.rank.asc())
        return list(self.db.execute(stmt).scalars().all())

    def list_for_round_with_user_names(self, *, round_id: uuid.UUID) -> list[tuple[RoundResult, str]]:
        stmt = (
            select(RoundResult, User.display_name)
            .join(User, RoundResult.user_id == User.id)
            .where(RoundResult.round_id == round_id)
            .order_by(RoundResult.rank.asc())
        )
        return list(self.db.execute(stmt).all())

    def list_for_user(self, *, user_id: uuid.UUID) -> list[RoundResult]:
        stmt = select(RoundResult).where(RoundResult.user_id == user_id).order_by(RoundResult.computed_at.desc())
        return list(self.db.execute(stmt).scalars().all())

