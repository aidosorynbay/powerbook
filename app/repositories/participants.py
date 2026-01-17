from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.round import RoundParticipant
from app.repositories.base import BaseRepository


class RoundParticipantRepository(BaseRepository[RoundParticipant]):
    def __init__(self, db: Session) -> None:
        super().__init__(db)

    def get(self, participant_id: uuid.UUID) -> RoundParticipant | None:
        return self.db.get(RoundParticipant, participant_id)

    def get_for_user(self, *, round_id: uuid.UUID, user_id: uuid.UUID) -> RoundParticipant | None:
        stmt = select(RoundParticipant).where(
            RoundParticipant.round_id == round_id,
            RoundParticipant.user_id == user_id,
        )
        return self.db.execute(stmt).scalar_one_or_none()

    def list_for_round(self, *, round_id: uuid.UUID) -> list[RoundParticipant]:
        stmt = select(RoundParticipant).where(RoundParticipant.round_id == round_id)
        return list(self.db.execute(stmt).scalars().all())

    def create(self, *, round_id: uuid.UUID, user_id: uuid.UUID) -> RoundParticipant:
        participant = RoundParticipant(round_id=round_id, user_id=user_id)
        self.db.add(participant)
        self.db.commit()
        self.db.refresh(participant)
        return participant

