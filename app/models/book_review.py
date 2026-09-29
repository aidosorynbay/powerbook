from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Index, SmallInteger, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import TimestampMixin


class BookReview(TimestampMixin, Base):
    """A reader's mark for a book, out of ten, and what they thought of it.

    One per reader per book. Given on the reader's own shelf and public from
    that moment: it shows on their shelf, on the book's page in the shared
    library and in the PowerBook rating of the book.

    work_key is the book's comparison key (app.core.booktitles), so every
    spelling of one book collects the same marks. The title and author are
    kept as the reader saw them, for a book nobody else has on a shelf.
    """

    __tablename__ = "book_reviews"
    __table_args__ = (
        UniqueConstraint("user_id", "work_key", name="uq_book_reviews_user_work"),
        Index("ix_book_reviews_work_key", "work_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    work_key: Mapped[str] = mapped_column(String(120), nullable=False)
    # Where on the reader's shelf the mark was given: "r:<hash>", "m:<id>", "u:<id>".
    volume_key: Mapped[str | None] = mapped_column(String(80), nullable=True, default=None)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    author: Mapped[str | None] = mapped_column(String(200), nullable=True, default=None)

    # 1..10, as Kinopoisk and as the circles have always written it ("9/10").
    rating: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    text: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
