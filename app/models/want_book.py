from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import TimestampMixin


class WantBook(TimestampMixin, Base):
    """A book a reader wants to read: their second shelf, «Хочу прочитать».

    The founder (2026-10-21): «Добавить на полку» from the shared library put a book among the read ones, and the
    shelf is what counts the books a reader has read. A book wanted is kept apart on purpose: it is on no shelf, in
    no count, in no fellow-readers list, and the shared library is not built from it.
    """

    __tablename__ = "want_books"
    __table_args__ = (UniqueConstraint("user_id", "title_norm", name="uq_want_books_user_title"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    title_norm: Mapped[str] = mapped_column(String(300), nullable=False)
    author: Mapped[str | None] = mapped_column(String(200), nullable=True, default=None)
    # The book of the shared library it was added from, when it was (its key may move as the library merges books;
    # the title finds it then).
    work_key: Mapped[str | None] = mapped_column(String(300), nullable=True, default=None)
