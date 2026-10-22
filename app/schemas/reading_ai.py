from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

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
    # from the world, not the club's library (book.key is then "x:<title>"; it has no card of its own)
    outside: bool = False
    # its page in the catalogue it was found in (Google Books, Flip.kz)
    link: str | None = None
    # where to get it: its search on Flip.kz
    buy_url: str | None = None
    # ≈ days to read it at the reader's pace, when its pages are known
    days: int | None = None
    # how well the book fits the reader's taste (percent) and by which of its traits (book_dna words: "mood:warm")
    match: int | None = None
    fits: list[str] = []


class BasisMarkOut(BaseModel):
    title: str
    mark: int


class BasisKinOut(BaseModel):
    name: str
    # on how many of the books both marked they are within two points
    agree: int
    shared: int


class BasisOut(BaseModel):
    """What the picks stand on, in full: the note on the page."""

    marks: list[BasisMarkOut] = []
    reviews_with_words: int = 0
    finished: list[str] = []
    long: list[str] = []
    dropped: list[str] = []
    favourites: list[str] = []
    wanted: list[str] = []
    dismissed: list[str] = []
    kindred: list[BasisKinOut] = []
    # books of the library with a DNA to match by, of all
    dna_known: int = 0
    dna_total: int = 0


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
    # the reader's minutes a reading day lately
    pace: int | None = None
    # what the reader asked for, when they did («что-то лёгкое на казахском»)
    wish: str | None = None
    # the reader's taste as the librarian reads it: traits they like, and dislike (book_dna words)
    likes: list[str] = []
    dislikes: list[str] = []
    basis: BasisOut | None = None


class PicksIn(BaseModel):
    lang: str = "ru"
    force: bool = False
    # the reader's own ask; with keep_wish the page writing itself again keeps the last one
    wish: str | None = Field(default=None, max_length=400)
    keep_wish: bool = False


class DismissIn(BaseModel):
    # the library's book, or "x:<title>" for one from the world (then title names it)
    work_key: str | None = None
    title: str | None = None
    author: str | None = None


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
