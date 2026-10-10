from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.share import DayCardOut, InvitesOut, MyDayCardOut, ShareDayIn
from app.services import day_share, invites

router = APIRouter(prefix="/share", tags=["share"])


@router.get("/day", response_model=MyDayCardOut)
def my_day(
    day: date,
    round_id: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MyDayCardOut:
    return day_share.my_card(db, user=user, day=day, round_id=round_id)


@router.post("/day")
def share_day(payload: ShareDayIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    day_share.share(
        db, user=user, round_id=payload.round_id, day=payload.day, channel=payload.channel,
        template=payload.template, action=payload.action, ink=payload.ink,
    )
    return {"ok": True}


@router.get("/invites", response_model=InvitesOut)
def my_invites(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> InvitesOut:
    """«Приведи друга»: who came by the reader's link and what they have read."""
    return invites.mine(db, user=user)


@router.get("/r/{username}", response_model=DayCardOut)
def reader_day(username: str, db: Session = Depends(get_db)) -> DayCardOut:
    """Open to anyone: it is where a shared day leads. Only a reader who has
    shared a day themselves has a page."""
    return day_share.public_card(db, username=username)
