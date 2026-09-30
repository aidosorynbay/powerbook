from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_current_user_optional
from app.db.session import get_db
from app.models.user import User
from app.schemas.waitlist import WaitlistJoinIn, WaitlistStateOut
from app.services import waitlist

router = APIRouter(prefix="/waitlist", tags=["waitlist"])


@router.get("", response_model=WaitlistStateOut)
def get_state(
    db: Session = Depends(get_db),
    user: User | None = Depends(get_current_user_optional),
) -> WaitlistStateOut:
    """Open to visitors too: the invitation page is shared with people who
    have no account yet."""
    return waitlist.state(db, user=user)


@router.post("", response_model=WaitlistStateOut)
def join(
    payload: WaitlistJoinIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> WaitlistStateOut:
    return waitlist.join(db, user=user, ref=payload.ref)


@router.delete("", response_model=WaitlistStateOut)
def leave(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> WaitlistStateOut:
    return waitlist.leave(db, user=user)
