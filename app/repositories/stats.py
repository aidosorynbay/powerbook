from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.claim import UsernameClaim
from app.models.enums import ClaimStatus, RoundParticipantStatus
from app.models.round import ReadingLog, Round, RoundParticipant
from app.repositories.base import BaseRepository


class StatsRepository(BaseRepository[None]):
    """Repository for aggregated statistics queries."""

    def __init__(self, db: Session) -> None:
        super().__init__(db)

    def count_total_unique_participants(self) -> int:
        """Distinct real people who ever participated in any round — claimed
        ghost/historical-import accounts are folded into their claimant so
        the same person isn't counted twice under two handles."""
        claim_map = self._approved_claim_map()
        stmt = select(func.distinct(RoundParticipant.user_id))
        raw_ids = [row[0] for row in self.db.execute(stmt).all()]
        resolved = {claim_map.get(uid, uid) for uid in raw_ids}
        return len(resolved)

    def count_total_participations(self) -> int:
        """Total reader-circle participations — every (user, round) row,
        counted as-is since each represents a real month someone joined,
        even if that person later claimed multiple old handles."""
        stmt = select(func.count(RoundParticipant.id))
        return self.db.execute(stmt).scalar() or 0

    def _approved_claim_map(self) -> dict[uuid.UUID, uuid.UUID]:
        stmt = select(UsernameClaim.ghost_user_id, UsernameClaim.claimant_user_id).where(
            UsernameClaim.status == ClaimStatus.approved
        )
        return {row[0]: row[1] for row in self.db.execute(stmt).all()}

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
