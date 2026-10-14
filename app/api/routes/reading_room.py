from __future__ import annotations

import uuid
from datetime import date, datetime

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.services.guest_room import GuestRoomService
from app.services.reading_room import ReadingRoomService

router = APIRouter(prefix="/reading-room", tags=["reading-room"])


class SitRequest(BaseModel):
    seat: int = Field(ge=0, le=63)
    book: str = Field(min_length=1, max_length=200)


class MessageRequest(BaseModel):
    text: str = Field(min_length=1, max_length=300)


class AwayAnswer(BaseModel):
    count: bool


class FinishRequest(BaseModel):
    # the reader's answer to «за какой день?» (state.my_session.days), when the room asked
    day: date | None = None


@router.get("/{hall}/public")
def room_public(hall: str, db: Session = Depends(get_db)) -> dict:
    """The room through the front page's window, for anyone: taken chairs, books and timers, no names."""
    return ReadingRoomService(db).public_state(hall=hall)


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
def finish(
    session_id: uuid.UUID, payload: FinishRequest | None = None, db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> dict:
    """Gets up: the reading time goes into «Сегодня» when the reader is in the current circle."""
    return ReadingRoomService(db).finish(session_id=session_id, user=user, day=payload.day if payload else None)


@router.post("/sessions/{session_id}/undo")
def undo(session_id: uuid.UUID, db: Session = Depends(get_db), user=Depends(get_current_user)) -> dict:
    return ReadingRoomService(db).undo(session_id=session_id, user=user)


# ---------- reading without an account (the front page's «Начать читать») ----------


class GuestSitRequest(BaseModel):
    seat: int = Field(ge=0, le=63)
    book: str = Field(default="", max_length=200)
    gender: str = Field(default="unknown", max_length=8)


class GuestToken(BaseModel):
    token: str = Field(min_length=8, max_length=80)


def _address(request: Request) -> str | None:
    """The visitor's address as the proxy saw it; None when the proxy doesn't say (then only the hall's cap holds)."""
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    return forwarded or request.headers.get("x-real-ip") or None


@router.post("/guest-sit")
def guest_sit(payload: GuestSitRequest, request: Request, db: Session = Depends(get_db)) -> dict:
    """A visitor takes a free chair in the library hall. The answer carries the token their browser keeps."""
    return GuestRoomService(db).sit(seat=payload.seat, book=payload.book, gender=payload.gender, address=_address(request))


@router.post("/guest/{sitting_id}/heartbeat")
def guest_heartbeat(sitting_id: uuid.UUID, payload: GuestToken, db: Session = Depends(get_db)) -> dict:
    return GuestRoomService(db).heartbeat(sitting_id=sitting_id, token=payload.token)


class GuestAway(GuestToken):
    count: bool


@router.post("/guest/{sitting_id}/away")
def guest_away(sitting_id: uuid.UUID, payload: GuestAway, db: Session = Depends(get_db)) -> dict:
    """«Экран был выключен N мин. Вы читали?» — the visitor's answer."""
    return GuestRoomService(db).answer_away(sitting_id=sitting_id, token=payload.token, count=payload.count)


@router.post("/guest/{sitting_id}/pause")
def guest_pause(sitting_id: uuid.UUID, payload: GuestToken, db: Session = Depends(get_db)) -> dict:
    return GuestRoomService(db).pause(sitting_id=sitting_id, token=payload.token)


@router.post("/guest/{sitting_id}/resume")
def guest_resume(sitting_id: uuid.UUID, payload: GuestToken, db: Session = Depends(get_db)) -> dict:
    return GuestRoomService(db).resume(sitting_id=sitting_id, token=payload.token)


@router.post("/guest/{sitting_id}/finish")
def guest_finish(sitting_id: uuid.UUID, payload: GuestToken, db: Session = Depends(get_db)) -> dict:
    return GuestRoomService(db).finish(sitting_id=sitting_id, token=payload.token)


@router.post("/guest/{sitting_id}/claim")
def guest_claim(
    sitting_id: uuid.UUID, payload: GuestToken, db: Session = Depends(get_db), user=Depends(get_current_user)
) -> dict:
    """The visitor signed up or logged in: their minutes become theirs."""
    return GuestRoomService(db).claim(sitting_id=sitting_id, token=payload.token, user=user)
