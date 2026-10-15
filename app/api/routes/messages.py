"""A reader's conversation with the founder, opened by «Хей, как вы?» (app/services/checkins.py)."""
from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.core.config import settings
from app.db.session import get_db
from app.models.user import User
from app.services import buddy_chat, checkins

router = APIRouter(prefix="/messages", tags=["messages"])


class AnswerIn(BaseModel):
    answer: str = Field(max_length=10)
    locale: str = Field(default="ru", max_length=5)


class TextIn(BaseModel):
    text: str = Field(min_length=1, max_length=checkins.MAX_CHARS)


@router.get("")
def my_thread(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    """The reader's conversation with the founder, and the message waiting on top of «Круг»."""
    return checkins.my_thread(db, user)


@router.get("/card")
def card(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    return {"card": checkins.card(db, user)}


@router.get("/unread")
def unread(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    """For the header: the founder's conversation(s) and the ones with other readers, together."""
    mine = checkins.unread(db, user)
    count, has = buddy_chat.unread(db, user)
    return {"count": mine["count"] + count, "has_thread": mine["has_thread"] or has}


@router.post("")
def write(payload: TextIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    return checkins.write(db, user, payload.text)


@router.post("/checkins/{checkin_id}/answer")
def answer(checkin_id: uuid.UUID, payload: AnswerIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    return checkins.answer(db, user, checkin_id, payload.answer, payload.locale)


# ---------- the founder ----------


@router.get("/threads")
def threads(db: Session = Depends(get_db), admin: User = Depends(require_admin)) -> list[dict]:
    return checkins.threads(db)


@router.get("/threads/{reader_id}")
def thread(reader_id: uuid.UUID, db: Session = Depends(get_db), admin: User = Depends(require_admin)) -> dict:
    return checkins.thread_for(db, admin, reader_id)


@router.post("/threads/{reader_id}")
def reply(reader_id: uuid.UUID, payload: TextIn, db: Session = Depends(get_db), admin: User = Depends(require_admin)) -> dict:
    return checkins.reply(db, admin, reader_id, payload.text)


@router.get("/checkins")
def today_list(db: Session = Depends(get_db), admin: User = Depends(require_admin)) -> dict:
    """The morning's list and how it is going, for when Telegram is not at hand."""
    return checkins.today_list(db)


@router.post("/checkins/approve/{day}")
def approve(day: date, db: Session = Depends(get_db), admin: User = Depends(require_admin)) -> dict:
    return {"approved": checkins.approve_day(db, day)}


@router.post("/checkins/{checkin_id}/skip")
def skip(checkin_id: uuid.UUID, db: Session = Depends(get_db), admin: User = Depends(require_admin)) -> dict:
    checkins.skip(db, checkin_id)
    return {"ok": True}


# ---------- between readers («buddy»), app/services/buddy_chat.py ----------


def _chat_on() -> None:
    """Parked until the club is bigger (settings.buddy_chat_enabled)."""
    if not settings.buddy_chat_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)


class ConsentIn(BaseModel):
    age_16: bool
    agree: bool


class BlockIn(BaseModel):
    on: bool


class ReportIn(BaseModel):
    reason: str = Field(min_length=1, max_length=1000)


@router.get("/chat/consent")
def chat_consent(db: Session = Depends(get_db), _: None = Depends(_chat_on), user: User = Depends(get_current_user)) -> dict:
    return {"consented": buddy_chat.consented(db, user.id), "version": buddy_chat.CONSENT_VERSION}


@router.post("/chat/consent")
def give_chat_consent(payload: ConsentIn, db: Session = Depends(get_db), _: None = Depends(_chat_on), user: User = Depends(get_current_user)) -> dict:
    return buddy_chat.give_consent(db, user, age_16=payload.age_16, agree=payload.agree)


@router.get("/chat")
def chats(db: Session = Depends(get_db), _: None = Depends(_chat_on), user: User = Depends(get_current_user)) -> list[dict]:
    return buddy_chat.conversations(db, user)


@router.get("/chat/{other_id}")
def chat(other_id: uuid.UUID, db: Session = Depends(get_db), _: None = Depends(_chat_on), user: User = Depends(get_current_user)) -> dict:
    return buddy_chat.conversation(db, user, other_id)


@router.post("/chat/{other_id}")
def send_chat(other_id: uuid.UUID, payload: TextIn, db: Session = Depends(get_db), _: None = Depends(_chat_on), user: User = Depends(get_current_user)) -> dict:
    return buddy_chat.send(db, user, other_id, payload.text)


@router.post("/chat/{other_id}/accept")
def accept_chat(other_id: uuid.UUID, db: Session = Depends(get_db), _: None = Depends(_chat_on), user: User = Depends(get_current_user)) -> dict:
    return buddy_chat.accept(db, user, other_id)


@router.post("/chat/{other_id}/block")
def block_chat(other_id: uuid.UUID, payload: BlockIn, db: Session = Depends(get_db), _: None = Depends(_chat_on), user: User = Depends(get_current_user)) -> dict:
    return buddy_chat.block(db, user, other_id, payload.on)


@router.post("/chat/{other_id}/report")
def report_chat(other_id: uuid.UUID, payload: ReportIn, db: Session = Depends(get_db), _: None = Depends(_chat_on), user: User = Depends(get_current_user)) -> dict:
    return buddy_chat.report(db, user, other_id, payload.reason)
