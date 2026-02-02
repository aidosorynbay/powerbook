from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.enums import RoundParticipantStatus
from app.models.round import ReadingLog, Round, RoundParticipant
from app.repositories.base import BaseRepository


class StatsRepository(BaseRepository[None]):
    """Repository for aggregated statistics queries."""

    def __init__(self, db: Session) -> None:
        super().__init__(db)

    def count_total_unique_participants(self) -> int:
        """Count total distinct users who ever participated in any round."""
        stmt = select(func.count(func.distinct(RoundParticipant.user_id)))
        return self.db.execute(stmt).scalar() or 0

    def sum_total_reading_minutes(self) -> int:
        """Sum all reading minutes across all rounds."""
        stmt = select(func.coalesce(func.sum(ReadingLog.minutes), 0))
        return self.db.execute(stmt).scalar() or 0

    def count_rounds_for_group(self, group_id: uuid.UUID) -> int:
        """Count total rounds for a specific group."""
        stmt = select(func.count(Round.id)).where(Round.group_id == group_id)
        return self.db.execute(stmt).scalar() or 0

    def count_active_participants_in_round(self, round_id: uuid.UUID) -> int:
        """Count active participants in a specific round."""
        stmt = select(func.count(RoundParticipant.id)).where(
            RoundParticipant.round_id == round_id,
            RoundParticipant.status == RoundParticipantStatus.active,
        )
        return self.db.execute(stmt).scalar() or 0
