from __future__ import annotations

import uuid
from datetime import date
from typing import TYPE_CHECKING

from sqlalchemy import Date, ForeignKey, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User


class ManualBook(TimestampMixin, Base):
    """A book a reader adds to their shelf by hand.

    The shelf is otherwise derived from reading_logs, so it only ever knows
    about books finished inside a round. This is for everything else — books
    read before joining, between rounds, or simply never logged.

    title_norm holds normalize_book_title(title) so the unique constraint
    catches the same book typed twice with different quoting or a trailing
    aside. Overlap with the round-derived shelf is resolved on read, in
    InsightsService.bookshelf().
    """

    __tablename__ = "manual_books"
    __table_args__ = (
        UniqueConstraint("user_id", "title_norm", name="uq_manual_books_user_title"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user: Mapped["User"] = relationship(foreign_keys=[user_id])

    title: Mapped[str] = mapped_column(String(300), nullable=False)
    title_norm: Mapped[str] = mapped_column(String(300), nullable=False)
    author: Mapped[str | None] = mapped_column(String(200), nullable=True, default=None)

    # When they finished it. Optional — most people won't remember, and the
    # shelf sorts undated entries last rather than demanding a guess.
    finished_on: Mapped[date | None] = mapped_column(Date, nullable=True, default=None)
