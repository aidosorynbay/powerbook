from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.enums import ClaimStatus
from app.repositories.claims import ClaimsRepository
from app.repositories.users import UserRepository
from app.schemas.claims import ClaimCandidateOut, MyClaimOut

MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _round_label(year: int, month: int) -> str:
    return f"{MONTHS[month]} {year}"


class ClaimsService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repo = ClaimsRepository(db)
        self.users = UserRepository(db)

    def search(self, *, user_id: uuid.UUID, query: str) -> list[ClaimCandidateOut]:
        query = query.strip()
        if len(query) < 2:
            return []
        candidates = self.repo.search_claimable(query=query, exclude_user_id=user_id, limit=20)
        out = []
        for ghost in candidates:
            rounds = self.repo.rounds_for_ghost(ghost_user_id=ghost.id)
            out.append(
                ClaimCandidateOut(
                    user_id=str(ghost.id),
                    username=ghost.username,
                    display_name=ghost.display_name,
                    rounds=[_round_label(y, m) for _rid, y, m in rounds],
                )
            )
        return out

    def submit_claim(self, *, user_id: uuid.UUID, ghost_user_id: uuid.UUID, note: str | None) -> MyClaimOut:
        if ghost_user_id == user_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot claim yourself")

        ghost = self.users.get(ghost_user_id)
        if ghost is None or not ghost.is_claimable:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This username isn't claimable")

        existing_active = self.repo.active_claim_for_ghost(ghost_user_id=ghost_user_id)
        if existing_active is not None:
            if existing_active.claimant_user_id == user_id:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="You already claimed this username")
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This username was already claimed by someone else")

        # Everyone the archive recorded as this same human, this one included.
        siblings = self._same_person(ghost)

        ghost_rounds = set()
        for sib in siblings:
            ghost_rounds |= self.repo.participated_round_ids(user_id=sib.id)
        covered_rounds = self.repo.covered_round_ids(claimant_user_id=user_id)
        clash = ghost_rounds & covered_rounds
        if clash:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This username shares a circle with an identity you've already claimed — "
                       "you can only be one person per circle",
            )

        # A previously-revoked claim between this exact pair leaves a row
        # behind (the unique constraint is on the pair, not the status) —
        # reactivate it instead of inserting a duplicate.
        asked_for = None
        for sib in siblings:
            existing_other = self.repo.active_claim_for_ghost(ghost_user_id=sib.id)
            if existing_other is not None and existing_other.claimant_user_id != user_id:
                # Someone else already owns this part of the identity; skip it
                # rather than fail the whole request.
                continue
            prior = self.repo.existing_claim(claimant_user_id=user_id, ghost_user_id=sib.id)
            claim = (self.repo.reactivate(prior, note=note) if prior is not None
                     else self.repo.create(claimant_user_id=user_id, ghost_user_id=sib.id, note=note))
            if sib.id == ghost_user_id:
                asked_for = claim
        if asked_for is None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail="This username was already claimed by someone else")
        return self._to_out(asked_for)

    def _same_person(self, ghost) -> list:
        """The archive accounts that are this same human.

        person_id is set only where a grouping was reviewed and approved;
        without one the account stands alone.
        """
        if not ghost.person_id:
            return [ghost]
        same = self.users.list_by_person(person_id=ghost.person_id)
        return same or [ghost]

    def my_claims(self, *, user_id: uuid.UUID) -> list[MyClaimOut]:
        claims = self.repo.list_for_claimant(claimant_user_id=user_id)
        return [self._to_out(c) for c in claims]

    def unclaim(self, *, user_id: uuid.UUID, claim_id: uuid.UUID) -> None:
        claim = self.repo.get(claim_id)
        if claim is None or claim.claimant_user_id != user_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Claim not found")
        if claim.status == ClaimStatus.approved:
            claim.status = ClaimStatus.revoked
            claim.reviewed_by_user_id = user_id
            claim.reviewed_at = datetime.now(timezone.utc)
            self.db.commit()

    def _to_out(self, claim) -> MyClaimOut:
        ghost = self.users.get(claim.ghost_user_id)
        rounds = self.repo.rounds_for_ghost(ghost_user_id=claim.ghost_user_id)
        return MyClaimOut(
            id=str(claim.id),
            ghost_user_id=str(claim.ghost_user_id),
            ghost_username=ghost.username if ghost else "?",
            ghost_display_name=ghost.display_name if ghost else "?",
            status=claim.status.value,
            note=claim.note,
            created_at=claim.created_at.isoformat(),
            rounds=[_round_label(y, m) for _rid, y, m in rounds],
        )
