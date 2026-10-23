from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import TimestampMixin


class BookPair(TimestampMixin, Base):
    """Two books of the shared library that look like one, and what the founder said or was asked about them.

    The council (2026-10-23): nothing joins on looks alone. A likely double goes to the founder once — in Telegram,
    «Одна книга» / «Разные» — and the answer is kept for good: «Одна книга» becomes a book link (book_links), and
    «Разные» stays here so the pair never comes back. Keyed by the books' keys, with their titles as they were, so a
    decision still finds its books when the way keys are made changes (app.core.booktitles).
    """

    __tablename__ = "book_pairs"
    __table_args__ = (UniqueConstraint("key_a", "key_b", name="uq_book_pairs_pair"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    key_a: Mapped[str] = mapped_column(String(120), nullable=False)
    key_b: Mapped[str] = mapped_column(String(120), nullable=False)
    title_a: Mapped[str] = mapped_column(String(300), nullable=False)
    title_b: Mapped[str] = mapped_column(String(300), nullable=False)
    # "asked": sent to the founder, no answer yet | "apart": «Разные» | "same": «Одна книга» (a book link was made)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="asked")
    decided_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, default=None
    )
