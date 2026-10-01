from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field


class LogBookIn(BaseModel):
    """One book of the day: its title and the minutes that went to it."""

    title: str = Field(max_length=300)
    minutes: int = Field(default=0, ge=0, le=24 * 60)
    finished: bool = False


class LogMinutesRequest(BaseModel):
    date: date
    minutes: int = Field(ge=0, le=24 * 60)
    book_finished: bool = False
    comment: str | None = None
    comment_private: bool = False
    # None leaves the day's books as they were (an older page that knows
    # nothing of them); a list, even empty, says what the day was spent on.
    books: list[LogBookIn] | None = Field(default=None, max_length=5)


class LogSessionRequest(BaseModel):
    """Minutes read in the reader, added on top of whatever the day has."""

    date: date
    minutes: int = Field(ge=1, le=24 * 60)
    title: str | None = Field(default=None, max_length=300)


class ReadingBooksOut(BaseModel):
    """«Что читаю»: the book(s) the form starts with, and others to pick from."""

    current: list[str]
    recent: list[str]


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
