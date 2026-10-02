from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.services.reading_room import ReadingRoomService

router = APIRouter(prefix="/reading-room", tags=["reading-room"])


class SitRequest(BaseModel):
    seat: int = Field(ge=0, le=63)
    book: str = Field(min_length=1, max_length=200)


class MessageRequest(BaseModel):
    text: str = Field(min_length=1, max_length=300)


class AwayAnswer(BaseModel):
    count: bool


@router.get("/{hall}/state")
def room_state(
    hall: str, since: datetime | None = None, db: Session = Depends(get_db), user=Depends(get_current_user)
) -> dict:
    """Who sits where with which book, the hall's chat since `since`, and my own sitting.
    Clients poll this every few seconds while the room is on screen."""
    return ReadingRoomService(db).state(hall=hall, user=user, since=since)


@router.post("/{hall}/sit")
def sit(hall: str, payload: SitRequest, db: Session = Depends(get_db), user=Depends(get_current_user)) -> dict:
    return ReadingRoomService(db).sit(hall=hall, user=user, seat=payload.seat, book=payload.book)


@router.post("/{hall}/messages")
def post_message(hall: str, payload: MessageRequest, db: Session = Depends(get_db), user=Depends(get_current_user)) -> dict:
    return ReadingRoomService(db).post_message(hall=hall, user=user, text=payload.text)


@router.post("/sessions/{session_id}/heartbeat")
def heartbeat(session_id: uuid.UUID, db: Session = Depends(get_db), user=Depends(get_current_user)) -> dict:
    return ReadingRoomService(db).heartbeat(session_id=session_id, user=user)


@router.post("/sessions/{session_id}/away")
def answer_away(
    session_id: uuid.UUID, payload: AwayAnswer, db: Session = Depends(get_db), user=Depends(get_current_user)
) -> dict:
    """Whether the reader read while their page was silent (a locked screen, another app): if so, the time counts."""
    return ReadingRoomService(db).answer_away(session_id=session_id, user=user, count=payload.count)


@router.post("/sessions/{session_id}/pause")
def pause(session_id: uuid.UUID, db: Session = Depends(get_db), user=Depends(get_current_user)) -> dict:
    return ReadingRoomService(db).pause(session_id=session_id, user=user)


@router.post("/sessions/{session_id}/resume")
def resume(session_id: uuid.UUID, db: Session = Depends(get_db), user=Depends(get_current_user)) -> dict:
    return ReadingRoomService(db).resume(session_id=session_id, user=user)


@router.post("/sessions/{session_id}/finish")
def finish(session_id: uuid.UUID, db: Session = Depends(get_db), user=Depends(get_current_user)) -> dict:
    """Gets up: the reading time goes into «Сегодня» when the reader is in the current circle."""
    return ReadingRoomService(db).finish(session_id=session_id, user=user)


@router.post("/sessions/{session_id}/undo")
def undo(session_id: uuid.UUID, db: Session = Depends(get_db), user=Depends(get_current_user)) -> dict:
    return ReadingRoomService(db).undo(session_id=session_id, user=user)
