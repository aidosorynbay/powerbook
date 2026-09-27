from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Index, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import TimestampMixin


class BookNote(TimestampMixin, Base):
    """A reader's own note on a book on their shelf: a thought, a quote, a page.

    Private to the reader. The finishing-day comment from a round stays where
    it is (reading_logs); these are the notes written on the shelf itself, as
    many as the reader likes, at any time.
    """

    __tablename__ = "book_notes"
    __table_args__ = (Index("ix_book_notes_user_volume", "user_id", "volume_key"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # The volume's key on the bookcase: "r:<hash>", "m:<id>" or "u:<id>".
    volume_key: Mapped[str] = mapped_column(String(80), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
