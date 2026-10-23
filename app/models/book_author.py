from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import TimestampMixin


class BookAuthor(TimestampMixin, Base):
    """The founder's word on a book of the shared library, for when the catalogues and readers' comments got it
    wrong: who wrote it, and what it is called. The book's card and every shelf holding the book show it
    (app.services.catalog).
    """

    __tablename__ = "book_authors"

    # A comparison key of the book (app.core.booktitles), as the shared library knows it.
    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    author: Mapped[str | None] = mapped_column(String(200), nullable=True, default=None)
    # The name the book goes by, when the founder says so (2026-10-23: «Монах, который продал свой Феррари»): the
    # card's title and, for every copy, the spelling its shelf shows. Empty: the readers' most used spelling.
    display_title: Mapped[str | None] = mapped_column(String(300), nullable=True, default=None)
    # Shown in the admin; the book as it was when the founder said it.
    title: Mapped[str | None] = mapped_column(String(300), nullable=True, default=None)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, default=None
    )

    def __str__(self) -> str:
        return f"{self.display_title or self.title or self.key} — {self.author or '…'}"
