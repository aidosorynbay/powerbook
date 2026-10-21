from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel

from app.schemas.books import CatalogItemOut


class PeriodBookOut(BaseModel):
    key: str
    work_key: str | None
    title: str
    author: str | None
    cover_url: str | None
    finished_on: str | None
    rating: int | None
    topics: list[str]
    notes_count: int
    has_comment: bool


class UnitOut(BaseModel):
    # "2026-09" for a month of a year, "2026-09-14" for a day of a month, "2026" for a year of all time
    key: str
    minutes: int
    books: int


class TopicShareOut(BaseModel):
    key: str
    count: int
    share: int


class AuthorCountOut(BaseModel):
    name: str
    count: int


class BestDayOut(BaseModel):
    date: str
    minutes: int


class ReadingOverviewOut(BaseModel):
    period: str
    years: list[int]
    months: list[int]
    minutes: int
    days_read: int
    longest_streak: int
    best_day: BestDayOut | None
    units: list[UnitOut]
    books: list[PeriodBookOut]
    topics: list[TopicShareOut]
    authors: list[AuthorCountOut]
    avg_rating: float | None
    rated_count: int
    notes_count: int
    ai_available: bool


class RecommendationOut(BaseModel):
    book: CatalogItemOut
    # "co_read" | "popular"
    reason: str
    because_title: str | None = None
    because_key: str | None = None
    shared_readers: int = 0


class PickOut(BaseModel):
    """One book the AI librarian picked, and why (app/services/librarian.py)."""

    book: CatalogItemOut
    why: str
    # on «Хочу прочитать» already: its id there
    want_id: str | None = None


class PicksOut(BaseModel):
    # the librarian is open to this reader (admins first, then everyone)
    enabled: bool
    ai_available: bool
    # marks enough to go on (librarian.MIN_MARKS)
    has_taste: bool
    # how many more marks before the first picks
    marks_missing: int = 0
    # None — never written; "working" | "done" | "error"
    status: str | None
    error: str | None = None
    taste: str | None = None
    picks: list[PickOut] = []
    # the reader's marks changed since: written again when opened
    stale: bool = False
    updated_at: datetime | None = None


class PicksIn(BaseModel):
    lang: str = "ru"
    force: bool = False


class DismissIn(BaseModel):
    work_key: str


class NoteOut(BaseModel):
    id: uuid.UUID
    text: str
    created_at: datetime


class NotebookEntryOut(BaseModel):
    key: str
    work_key: str | None
    title: str
    author: str | None
    cover_url: str | None
    finished_on: str | None
    comment: str | None
    comment_private: bool
    notes: list[NoteOut]
    rating: int | None
    review: str | None
    last_at: str | None


class DigestIn(BaseModel):
    # "period" | "book" | "round"
    kind: str
    scope: str
    lang: str = "ru"
    force: bool = False


class DigestOut(BaseModel):
    id: uuid.UUID
    kind: str
    scope: str
    lang: str
    status: str
    content: dict | None
    error: str | None
    updated_at: datetime
    # The reading behind it changed since it was written.
    stale: bool = False
