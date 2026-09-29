from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import TimestampMixin


class BookFact(TimestampMixin, Base):
    """What the world says about a book on PowerBook shelves: its rating
    elsewhere, what it is about, what readers think of it, its subjects.

    One row per book of the shared library, keyed by its comparison key and
    filled in the background (app.services.book_facts), the way book_covers
    is. Every number and text keeps its source and a link to it: the page
    says where a rating comes from, it never passes one off as ours.
    """

    __tablename__ = "book_facts"

    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    author: Mapped[str | None] = mapped_column(String(200), nullable=True, default=None)
    # "pending" | "working" | "found" | "none" | "error"
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="pending")

    # The rating elsewhere, on that source's own scale (Goodreads, LiveLib,
    # Google Books and Open Library all count out of 5).
    rating: Mapped[float | None] = mapped_column(Float, nullable=True, default=None)
    rating_scale: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    ratings_count: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)
    # "goodreads" | "livelib" | "google" | "openlibrary"
    rating_source: Mapped[str | None] = mapped_column(String(20), nullable=True, default=None)
    rating_url: Mapped[str | None] = mapped_column(String(500), nullable=True, default=None)
    goodreads_url: Mapped[str | None] = mapped_column(String(500), nullable=True, default=None)

    # {"ru": {"text": ..., "source": "wikipedia", "url": ...}, "en": {...}, "kk": {...}}
    about: Mapped[dict | None] = mapped_column(JSON, nullable=True, default=None)
    # What readers elsewhere say, in our own words: {"ru": ..., "kk": ..., "en": ...}
    review: Mapped[dict | None] = mapped_column(JSON, nullable=True, default=None)
    review_source: Mapped[str | None] = mapped_column(String(20), nullable=True, default=None)

    # Topic keys from app.services.topics, for the reading summaries.
    topics: Mapped[list | None] = mapped_column(JSON, nullable=True, default=None)
    # The catalogues' own words for it, kept to re-derive topics later.
    subjects: Mapped[list | None] = mapped_column(JSON, nullable=True, default=None)
    pages: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)
    year: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)

    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=None)
    # The Claude pass (web search for the Goodreads/LiveLib rating and the
    # readers' verdict): None = not yet, "found" | "none" | "error".
    ai_status: Mapped[str | None] = mapped_column(String(12), nullable=True, default=None)
    ai_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=None)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
