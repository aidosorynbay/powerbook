from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import TimestampMixin


class CustomShelf(TimestampMixin, Base):
    """One shelf in a reader's bookcase, named for its theme ("Бизнес",
    "Классика"). The reader orders them; books not placed anywhere sit on an
    implicit "unsorted" shelf at the bottom."""

    __tablename__ = "custom_shelves"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class ShelfPlacement(TimestampMixin, Base):
    """Which of the reader's shelves a book stands on. One shelf per book,
    as on a real bookcase; no row means unsorted."""

    __tablename__ = "shelf_placements"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    # The volume's key on the bookcase: "r:<hash>", "m:<id>" or "u:<id>".
    volume_key: Mapped[str] = mapped_column(String(80), primary_key=True)
    shelf_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("custom_shelves.id", ondelete="CASCADE"), nullable=False
    )
