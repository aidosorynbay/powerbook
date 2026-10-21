from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import TimestampMixin


class BookDismissal(TimestampMixin, Base):
    """«Не моё»: a book the AI librarian suggested and the reader turned down (app/services/librarian.py).

    It is never suggested to them again, and the librarian is told about it, so the next picks learn from it.
    """

    __tablename__ = "book_dismissals"
    __table_args__ = (UniqueConstraint("user_id", "work_key", name="uq_book_dismissals_user_work"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    work_key: Mapped[str] = mapped_column(String(300), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    author: Mapped[str | None] = mapped_column(String(200), nullable=True, default=None)
