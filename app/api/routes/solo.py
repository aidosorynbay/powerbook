from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.services.solo import SoloService

router = APIRouter(prefix="/solo", tags=["solo"])


class SoloBook(BaseModel):
    title: str = Field(max_length=300)
    minutes: int = Field(default=0, ge=0, le=1440)


class SoloDayRequest(BaseModel):
    date: date
    minutes: int = Field(ge=0, le=1440)
    # None keeps the day's books as they are
    books: list[SoloBook] | None = Field(default=None, max_length=10)


@router.get("/month")
def solo_month(
    year: int | None = None, month: int | None = None, db: Session = Depends(get_db), user=Depends(get_current_user)
) -> dict:
    """A reader's own month outside the circle: each day's minutes and books, for the dial and the calendar."""
    return SoloService(db).month(user_id=user.id, year=year, month=month)


@router.put("/day")
def solo_day(payload: SoloDayRequest, db: Session = Depends(get_db), user=Depends(get_current_user)) -> dict:
    books = [(b.title, b.minutes) for b in payload.books] if payload.books is not None else None
    return SoloService(db).set_day(user_id=user.id, day=payload.date, minutes=payload.minutes, books=books)
