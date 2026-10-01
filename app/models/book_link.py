from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import TimestampMixin


class BookLink(TimestampMixin, Base):
    """The founder's word that two books of the shared library are one:
    a translation and its original, an edition sold under another title.
    The shared library joins every link transitively, as it joins spellings.
    """

    __tablename__ = "book_links"
    __table_args__ = (UniqueConstraint("key_a", "key_b", name="uq_book_links_pair"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Comparison keys (app.core.booktitles), as the shared library knows its books.
    key_a: Mapped[str] = mapped_column(String(120), nullable=False)
    key_b: Mapped[str] = mapped_column(String(120), nullable=False)
    # Shown in the admin; who linked them.
    title_a: Mapped[str | None] = mapped_column(String(300), nullable=True, default=None)
    title_b: Mapped[str | None] = mapped_column(String(300), nullable=True, default=None)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, default=None
    )

    def __str__(self) -> str:
        return f"{self.title_a or self.key_a} = {self.title_b or self.key_b}"
