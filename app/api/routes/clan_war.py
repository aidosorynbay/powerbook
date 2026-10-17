import uuid
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_current_user_optional, require_admin
from app.db.session import get_db
from app.services import clan_war, clan_war_chat

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
    day: Literal["today", "yesterday"] = "today"


@router.post("/read")
def war_read(body: ReadIn, db: Session = Depends(get_db), user=Depends(get_current_user)) -> dict:
    """A day's minutes from the war page: into the circle's log for a circle reader, the war's for a guest."""
    return clan_war.log_read(db, user, body.minutes, body.day)


@router.get("/chat")
def war_chat(db: Session = Depends(get_db), user=Depends(get_current_user)) -> dict:
    """The team's own room: only its members see it."""
    return clan_war_chat.room(db, user)


class ChatConsentIn(BaseModel):
    age_16: bool
    agree: bool


@router.post("/chat/consent")
def war_chat_consent(body: ChatConsentIn, db: Session = Depends(get_db), user=Depends(get_current_user)) -> dict:
    return clan_war_chat.consent(db, user, age_16=body.age_16, agree=body.agree)


class ChatIn(BaseModel):
    text: str


@router.post("/chat")
def war_chat_post(body: ChatIn, db: Session = Depends(get_db), user=Depends(get_current_user)) -> dict:
    return clan_war_chat.post(db, user, body.text)


@router.post("/chat/{message_id}/delete")
def war_chat_delete(message_id: uuid.UUID, db: Session = Depends(get_db), user=Depends(get_current_user)) -> dict:
    return clan_war_chat.delete(db, user, message_id)


class ReportIn(BaseModel):
    reason: str | None = None


@router.post("/chat/{message_id}/report")
def war_chat_report(message_id: uuid.UUID, body: ReportIn, db: Session = Depends(get_db), user=Depends(get_current_user)) -> dict:
    return clan_war_chat.report(db, user, message_id, body.reason)
