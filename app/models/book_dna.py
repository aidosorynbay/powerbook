from __future__ import annotations

from sqlalchemy import JSON, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import TimestampMixin


class BookDna(TimestampMixin, Base):
    """What a book of the shared library is like, beyond its genre: its mood, pace, length, themes, form, style, era and
    how demanding it is (app/services/book_dna.py). The AI librarian matches books to a reader's taste by it.

    Written by the AI once per book, from what it knows and the book's description; `status` "unknown" when it did
    not know the book well enough to say."""

    __tablename__ = "book_dna"

    # the library's work key
    key: Mapped[str] = mapped_column(String(300), primary_key=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    author: Mapped[str | None] = mapped_column(String(200), nullable=True, default=None)
    # "done" | "unknown" | "error"
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="done")
    # {"mood": [...], "pace": "...", "length": "...", "themes": [...], "form": "...", "style": [...], "era": "...",
    #  "ease": "..."} — values from book_dna.VOCAB only
    traits: Mapped[dict | None] = mapped_column(JSON, nullable=True, default=None)
    # one line on what the book is, in English, for the librarian
    essence: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    model: Mapped[str | None] = mapped_column(String(60), nullable=True, default=None)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
