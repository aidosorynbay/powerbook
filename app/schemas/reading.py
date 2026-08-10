from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field


class LogMinutesRequest(BaseModel):
    date: date
    minutes: int = Field(ge=0, le=24 * 60)
    book_finished: bool = False
    comment: str | None = None
    comment_private: bool = False


class ReactionOut(BaseModel):
    count: int
    reacted_by_me: bool


class RosterEntryOut(BaseModel):
    user_id: str
    display_name: str
    telegram_id: str | None
    minutes: int
    score: int
    book_finished: bool
    comment: str | None
