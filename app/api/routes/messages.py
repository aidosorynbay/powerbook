"""A reader's conversation with the founder, opened by «Хей, как вы?» (app/services/checkins.py)."""
from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.db.session import get_db
from app.models.user import User
from app.services import checkins

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
    return checkins.unread(db, user)


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
