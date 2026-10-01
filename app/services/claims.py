from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.booktitles import match_key
from app.models.enums import ClaimStatus
from app.models.round import Round, RoundParticipant
from app.repositories.claims import ClaimsRepository
from app.repositories.users import UserRepository
from app.schemas.claims import ClaimCandidateOut, ClaimSuggestionsOut, MyClaimOut
from app.services import claim_match

MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _round_label(year: int, month: int) -> str:
    return f"{MONTHS[month]} {year}"


class ClaimsService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repo = ClaimsRepository(db)
        self.users = UserRepository(db)

    def _candidate(self, ghost_id: uuid.UUID, username: str, display_name: str) -> ClaimCandidateOut:
        rounds = self.repo.rounds_for_ghost(ghost_user_id=ghost_id)
        return ClaimCandidateOut(
            user_id=str(ghost_id),
            username=username,
            display_name=display_name,
            rounds=[_round_label(y, m) for _rid, y, m in rounds],
        )

    def search(self, *, user_id: uuid.UUID, query: str) -> list[ClaimCandidateOut]:
        """Archive nicknames for what the reader typed, in either script:
        «Сайра» finds "Saira" as well as «Сайра»."""
        query = query.strip()
        if len(query) < 2:
            return []
        ranked: dict[uuid.UUID, tuple[int, str, str]] = {}
        key = match_key(query.lstrip("@"))
        if len(key) >= 2:
            for ghost in claim_match.claimable_ghosts(self.db):
                rank = claim_match.query_matches(key, ghost)
                if rank and ghost.id != user_id:
                    ranked[ghost.id] = (rank, ghost.username, ghost.display_name)
        # The plain substring search still counts, for anything the skeleton folds away.
        for ghost in self.repo.search_claimable(query=query, exclude_user_id=user_id, limit=20):
            ranked.setdefault(ghost.id, (1, ghost.username, ghost.display_name))
        best = sorted(ranked.items(), key=lambda item: (-item[1][0], item[1][1].casefold()))[:20]
        return [self._candidate(ghost_id, username, display) for ghost_id, (_rank, username, display) in best]

    def has_archive(self, *, user_id: uuid.UUID) -> bool:
        """Whether the reader's own account already carries circles from before
        it was opened: the import matched them, so their history is there."""
        user = self.users.get(user_id)
        if user is None or user.created_at is None:
            return False
        opened = user.created_at.year * 12 + user.created_at.month
        months = self.db.execute(
            select(Round.year, Round.month)
            .join(RoundParticipant, RoundParticipant.round_id == Round.id)
            .where(RoundParticipant.user_id == user_id)
        ).all()
        return any(year * 12 + month < opened for year, month in months)

    def suggestions(self, *, user_id: uuid.UUID, limit: int = 5) -> list[ClaimCandidateOut]:
        """Archive nicknames that look like this reader's names (username,
        display name, Telegram), best first. Leaves out anything already
        granted to someone, anything this reader has asked for, and anything
        that shares a circle with them (they could not have read twice)."""
        user = self.users.get(user_id)
        if user is None:
            return []
        mine = claim_match.keys(user.username, user.display_name, user.telegram_id)
        granted = self.repo.approved_ghost_ids()
        asked = {c.ghost_user_id for c in self.repo.list_for_claimant(claimant_user_id=user_id) if c.status != ClaimStatus.revoked}
        scored = []
        for ghost in claim_match.claimable_ghosts(self.db):
            if ghost.id == user_id or ghost.id in granted or ghost.id in asked:
                continue
            sc = claim_match.score(mine, ghost.keys)
            if sc >= claim_match.THRESHOLD:
                scored.append((sc, ghost))
        scored.sort(key=lambda item: (-item[0], item[1].username.casefold()))
        covered = self.repo.covered_round_ids(claimant_user_id=user_id)
        out: list[ClaimCandidateOut] = []
        for _sc, ghost in scored:
            rounds = self.repo.rounds_for_ghost(ghost_user_id=ghost.id)
            if not rounds or ({rid for rid, _y, _m in rounds} & covered):
                continue
            out.append(
                ClaimCandidateOut(
                    user_id=str(ghost.id),
                    username=ghost.username,
                    display_name=ghost.display_name,
                    rounds=[_round_label(y, m) for _rid, y, m in rounds],
                )
            )
            if len(out) >= limit:
                break
        return out

    def suggestions_for(self, *, user_id: uuid.UUID) -> ClaimSuggestionsOut:
        return ClaimSuggestionsOut(
            has_archive=self.has_archive(user_id=user_id),
            suggestions=self.suggestions(user_id=user_id),
        )

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
        # Approved or still waiting, the reader can take it back. A request
        # that was only waiting used to stay in the queue when "cancelled".
        if claim.status in (ClaimStatus.approved, ClaimStatus.pending):
            claim.status = ClaimStatus.revoked
            claim.reviewed_by_user_id = user_id
            claim.reviewed_at = datetime.now(timezone.utc)
            self.db.commit()

    def link_by_admin(self, *, user_id: uuid.UUID, ghost_user_id: uuid.UUID, admin_id: uuid.UUID | None) -> MyClaimOut:
        """The founder recognising a reader in the archive: the same checks as
        a reader's own request, granted at once."""
        out = self.submit_claim(user_id=user_id, ghost_user_id=ghost_user_id, note="linked by admin")
        now = datetime.now(timezone.utc)
        for claim in self.repo.list_for_claimant(claimant_user_id=user_id):
            if claim.status == ClaimStatus.pending and claim.note == "linked by admin":
                taken = self.repo.active_claim_for_ghost(ghost_user_id=claim.ghost_user_id)
                if taken is not None and taken.id != claim.id:
                    continue
                claim.status = ClaimStatus.approved
                claim.reviewed_by_user_id = admin_id
                claim.reviewed_at = now
        self.db.commit()
        return out

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
