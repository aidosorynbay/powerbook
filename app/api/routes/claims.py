from __future__ import annotations

import uuid

import time

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.routes.auth import TELEGRAM_AUTH_MAX_AGE, _verify_telegram_auth
from app.core.config import settings
from app.db.session import get_db
from app.schemas.claims import ClaimCandidateOut, ClaimCreateRequest, ClaimSuggestionsOut, MyClaimOut, TelegramClaimRequest
from app.services import admin_ping
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
    service = ClaimsService(db)
    out = service.submit_claim(
        user_id=user.id,
        ghost_user_id=uuid.UUID(payload.ghost_user_id),
        note=payload.note,
    )
    # The founder hears in Telegram, so nobody waits for them to open /admin.
    ghost = service.users.get(uuid.UUID(out.ghost_user_id))
    if ghost is not None and out.status == "pending":
        admin_ping.claim_waiting(claim_id=out.id, claimant=user, ghost=ghost, rounds=out.rounds, note=out.note)
    return out


@router.post("/telegram", response_model=list[MyClaimOut])
def claim_by_telegram(
    payload: TelegramClaimRequest,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> list[MyClaimOut]:
    """«Подтвердить через Telegram»: Telegram vouches that the nickname is the
    reader's, so the archive kept under it is theirs at once."""
    if not settings.telegram_bot_token:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Telegram not configured")
    if not _verify_telegram_auth(payload.model_dump(), settings.telegram_bot_token):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Telegram auth data")
    if time.time() - payload.auth_date > TELEGRAM_AUTH_MAX_AGE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Telegram auth expired, please try again")
    if not payload.username:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No archive under this Telegram")
    out = ClaimsService(db).link_by_telegram(user_id=user.id, nick=payload.username)
    admin_ping.claim_by_telegram(claimant=user, nick=payload.username, rounds=sum(len(c.rounds) for c in out))
    return out


@router.delete("/{claim_id}")
def unclaim(claim_id: uuid.UUID, db: Session = Depends(get_db), user=Depends(get_current_user)) -> dict:
    ClaimsService(db).unclaim(user_id=user.id, claim_id=claim_id)
    return {"ok": True}
