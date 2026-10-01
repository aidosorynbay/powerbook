from __future__ import annotations

import uuid

from sqlalchemy import JSON, ForeignKey, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import TimestampMixin


class BookChat(TimestampMixin, Base):
    """A reader's conversation with the AI about one book («Обсудить с AI»).

    One per reader per book of the shared library, so the talk picks up
    where it stopped from the shelf, the book's page or the reader. Only
    the last messages are kept; the reader can start over.
    """

    __tablename__ = "book_chats"
    __table_args__ = (UniqueConstraint("user_id", "work_key", name="uq_book_chats_user_work"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # The book's comparison key in the shared library (app.core.booktitles).
    work_key: Mapped[str] = mapped_column(String(120), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    # [{"role": "user" | "assistant", "content": str, "at": ISO time}]
    messages: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
