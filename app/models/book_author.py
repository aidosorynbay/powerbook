from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import TimestampMixin


class BookAuthor(TimestampMixin, Base):
    """The founder's word on who wrote a book of the shared library, for when
    the catalogues and readers' comments got it wrong. The book's card and
    every shelf holding the book show it (app.services.catalog).
    """

    __tablename__ = "book_authors"

    # A comparison key of the book (app.core.booktitles), as the shared library knows it.
    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    author: Mapped[str] = mapped_column(String(200), nullable=False)
    # Shown in the admin; who said it.
    title: Mapped[str | None] = mapped_column(String(300), nullable=True, default=None)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, default=None
    )

    def __str__(self) -> str:
        return f"{self.title or self.key} — {self.author}"
