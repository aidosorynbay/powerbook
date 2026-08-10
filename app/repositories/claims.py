from __future__ import annotations

import uuid

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models.claim import UsernameClaim
from app.models.enums import ClaimStatus
from app.models.round import Round, RoundParticipant
from app.models.user import User
from app.repositories.base import BaseRepository


class ClaimsRepository(BaseRepository[UsernameClaim]):
    def __init__(self, db: Session) -> None:
        super().__init__(db)

    # ---------- ghost search ----------

    def search_claimable(self, *, query: str, exclude_user_id: uuid.UUID, limit: int = 20) -> list[User]:
        stmt = (
            select(User)
            .where(
                User.is_claimable.is_(True),
                User.id != exclude_user_id,
                or_(
                    User.username.ilike(f"%{query}%"),
                    User.display_name.ilike(f"%{query}%"),
                ),
            )
            .order_by(User.username.asc())
            .limit(limit)
        )
        return list(self.db.execute(stmt).scalars().all())

    def rounds_for_ghost(self, *, ghost_user_id: uuid.UUID) -> list[tuple[uuid.UUID, int, int]]:
        stmt = (
            select(Round.id, Round.year, Round.month)
            .join(RoundParticipant, RoundParticipant.round_id == Round.id)
            .where(RoundParticipant.user_id == ghost_user_id)
            .order_by(Round.year.desc(), Round.month.desc())
        )
        return [(row[0], row[1], row[2]) for row in self.db.execute(stmt).all()]

    # ---------- round-id sets, for the "one identity per circle" rule ----------

    def participated_round_ids(self, *, user_id: uuid.UUID) -> set[uuid.UUID]:
        stmt = select(RoundParticipant.round_id).where(RoundParticipant.user_id == user_id)
        return {row[0] for row in self.db.execute(stmt).all()}

    def covered_round_ids(self, *, claimant_user_id: uuid.UUID) -> set[uuid.UUID]:
        """Rounds already 'occupied' by this claimant: their own participation
        plus every ghost they already have an approved claim on."""
        covered = self.participated_round_ids(user_id=claimant_user_id)
        for ghost_id in self.approved_ghost_ids_for_claimant(claimant_user_id=claimant_user_id):
            covered |= self.participated_round_ids(user_id=ghost_id)
        return covered

    def approved_ghost_ids_for_claimant(self, *, claimant_user_id: uuid.UUID) -> list[uuid.UUID]:
        stmt = select(UsernameClaim.ghost_user_id).where(
            UsernameClaim.claimant_user_id == claimant_user_id,
            UsernameClaim.status == ClaimStatus.approved,
        )
        return [row[0] for row in self.db.execute(stmt).all()]

    def effective_user_ids(self, *, user_id: uuid.UUID) -> list[uuid.UUID]:
        return [user_id, *self.approved_ghost_ids_for_claimant(claimant_user_id=user_id)]

    # ---------- claim CRUD ----------

    def active_claim_for_ghost(self, *, ghost_user_id: uuid.UUID) -> UsernameClaim | None:
        stmt = select(UsernameClaim).where(
            UsernameClaim.ghost_user_id == ghost_user_id,
            UsernameClaim.status == ClaimStatus.approved,
        )
        return self.db.execute(stmt).scalar_one_or_none()

    def get(self, claim_id: uuid.UUID) -> UsernameClaim | None:
        return self.db.get(UsernameClaim, claim_id)

    def existing_claim(self, *, claimant_user_id: uuid.UUID, ghost_user_id: uuid.UUID) -> UsernameClaim | None:
        """Any claim row between this pair, regardless of status — the
        (claimant, ghost) unique constraint means a revoked claim has to be
        reactivated rather than re-inserted."""
        stmt = select(UsernameClaim).where(
            UsernameClaim.claimant_user_id == claimant_user_id,
            UsernameClaim.ghost_user_id == ghost_user_id,
        )
        return self.db.execute(stmt).scalar_one_or_none()

    def list_for_claimant(self, *, claimant_user_id: uuid.UUID) -> list[UsernameClaim]:
        stmt = (
            select(UsernameClaim)
            .where(UsernameClaim.claimant_user_id == claimant_user_id)
            .order_by(UsernameClaim.created_at.desc())
        )
        return list(self.db.execute(stmt).scalars().all())

    def create(self, *, claimant_user_id: uuid.UUID, ghost_user_id: uuid.UUID, note: str | None) -> UsernameClaim:
        claim = UsernameClaim(claimant_user_id=claimant_user_id, ghost_user_id=ghost_user_id, note=note)
        self.db.add(claim)
        self.db.commit()
        self.db.refresh(claim)
        return claim

    def reactivate(self, claim: UsernameClaim, *, note: str | None) -> UsernameClaim:
        claim.status = ClaimStatus.approved
        claim.note = note
        claim.reviewed_by_user_id = None
        claim.reviewed_at = None
        self.db.commit()
        self.db.refresh(claim)
        return claim
