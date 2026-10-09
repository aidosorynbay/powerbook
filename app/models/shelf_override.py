from __future__ import annotations

import uuid

from sqlalchemy import Boolean, ForeignKey, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import TimestampMixin


class ShelfOverride(TimestampMixin, Base):
    """A reader's own correction to one book on their shelf.

    Per reader, not per title: fixing a wrong cover on your shelf must not
    change what everyone else who read the book sees. The cover cache
    (book_covers) stays the shared best guess; this is the reader's word
    over it, for their shelf only.
    """

    __tablename__ = "shelf_overrides"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    # The volume's key on the bookcase: "r:<hash>", "m:<id>", "u:<id>" or "l:<hash>" (read in the days only).
    volume_key: Mapped[str] = mapped_column(String(80), primary_key=True)

    title: Mapped[str | None] = mapped_column(String(300), nullable=True, default=None)
    author: Mapped[str | None] = mapped_column(String(200), nullable=True, default=None)

    # "auto" — whatever the lookup found; "none" — the painted edition;
    # "image" — a cover the reader picked from search or photographed.
    cover_mode: Mapped[str] = mapped_column(String(12), nullable=False, default="auto")
    image: Mapped[str | None] = mapped_column(String(60), nullable=True, default=None)
    source: Mapped[str | None] = mapped_column(String(20), nullable=True, default=None)
    source_id: Mapped[str | None] = mapped_column(String(40), nullable=True, default=None)

    # The book of the shared library the reader said this one is («Какая это
    # книга?»): their copy counts as that book, whatever its file or edition
    # was called. A comparison key from app.core.booktitles.
    work_key: Mapped[str | None] = mapped_column(String(120), nullable=True, default=None)

    # «Убрать с полки»: not a book at all (a finished day's comment that is no title, say). The shelf and the shared
    # library leave it out; the day, its minutes and its comment stay as they are.
    hidden: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
