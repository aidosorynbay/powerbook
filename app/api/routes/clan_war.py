from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_current_user_optional, require_admin
from app.db.session import get_db
from app.services import clan_war

router = APIRouter(prefix="/war", tags=["war"])


@router.get("")
def get_war(db: Session = Depends(get_db), user=Depends(get_current_user_optional)) -> dict:
    """The current clan war, open to anyone: teams, fortresses, shields by day."""
    return clan_war.state(db, user)


@router.post("/join")
def join_war(db: Session = Depends(get_db), user=Depends(get_current_user)) -> dict:
    return clan_war.join(db, user)


@router.post("/leave")
def leave_war(db: Session = Depends(get_db), user=Depends(get_current_user)) -> dict:
    return clan_war.leave(db, user)


@router.post("/split")
def split_war(db: Session = Depends(get_db), admin=Depends(require_admin)) -> dict:
    return clan_war.split(db, admin)


class PrizeIn(BaseModel):
    prize: str | None = None


@router.put("/prize")
def put_prize(body: PrizeIn, db: Session = Depends(get_db), admin=Depends(require_admin)) -> dict:
    return clan_war.set_prize(db, body.prize)


class ReadIn(BaseModel):
    minutes: int


@router.post("/read")
def war_read(body: ReadIn, db: Session = Depends(get_db), user=Depends(get_current_user)) -> dict:
    """Minutes for today from a war member outside the month's circle."""
    return clan_war.log_guest(db, user, body.minutes)
