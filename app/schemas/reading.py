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
    # With a book finished: the day it was begun. Days since then with no
    # book named count for it.
    started_on: date | None = None


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


class FinishChoiceOut(BaseModel):
    """A book of the shelf or the shared library the finished title may be."""

    key: str
    # The title to save it under: the shelf's spelling when the reader has it.
    title: str
    author: str | None
    cover_thumb_url: str | None
    readers: int
    on_shelf: bool


class BookFinishOut(BaseModel):
    """«Книга прочитана», before saving: which book, and how long it took."""

    exact: bool
    choices: list[FinishChoiceOut]
    start: date
    suggested: date
    earliest: date
    minutes: int
    days: int
    filled_days: int
    # Books that days with no book named are shared with (read at the same time).
    shared_with: list[str] = []


class BookDayOtherOut(BaseModel):
    title: str
    minutes: int


class BookDayOut(BaseModel):
    date: date
    # The day's minutes, all books.
    total: int
    # This book's.
    minutes: int
    # What ticking the day would give it.
    offer: int
    # The day it was finished.
    finish: bool
    others: list[BookDayOtherOut]


class BookDaysOut(BaseModel):
    """«Дни чтения»: a finished book's days, one by one."""

    title: str
    day: date
    earliest: date
    days: list[BookDayOut]
    minutes: int
    days_read: int


class BookDayIn(BaseModel):
    date: date
    minutes: int = Field(ge=0, le=24 * 60)


class BookDaysIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    # The day the book was finished.
    day: date
    # Every day shown, with this book's minutes (0: not its day).
    days: list[BookDayIn] = Field(max_length=400)
