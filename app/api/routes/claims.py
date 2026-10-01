from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.schemas.claims import ClaimCandidateOut, ClaimCreateRequest, ClaimSuggestionsOut, MyClaimOut
from app.services.claims import ClaimsService

router = APIRouter(prefix="/claims", tags=["claims"])


@router.get("/search", response_model=list[ClaimCandidateOut])
def search_claimable(
    q: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> list[ClaimCandidateOut]:
    return ClaimsService(db).search(user_id=user.id, query=q)


@router.get("/suggestions", response_model=ClaimSuggestionsOut)
def claim_suggestions(db: Session = Depends(get_db), user=Depends(get_current_user)) -> ClaimSuggestionsOut:
    """«Это вы?» — archive nicknames that look like this reader's own names."""
    return ClaimsService(db).suggestions_for(user_id=user.id)


@router.get("/mine", response_model=list[MyClaimOut])
def my_claims(db: Session = Depends(get_db), user=Depends(get_current_user)) -> list[MyClaimOut]:
    return ClaimsService(db).my_claims(user_id=user.id)


@router.post("", response_model=MyClaimOut)
def create_claim(
    payload: ClaimCreateRequest,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> MyClaimOut:
    return ClaimsService(db).submit_claim(
        user_id=user.id,
        ghost_user_id=uuid.UUID(payload.ghost_user_id),
        note=payload.note,
    )


@router.delete("/{claim_id}")
def unclaim(claim_id: uuid.UUID, db: Session = Depends(get_db), user=Depends(get_current_user)) -> dict:
    ClaimsService(db).unclaim(user_id=user.id, claim_id=claim_id)
    return {"ok": True}
