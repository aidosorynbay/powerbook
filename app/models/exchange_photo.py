from __future__ import annotations

import uuid

from sqlalchemy import Boolean, ForeignKey, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import TimestampMixin


class ExchangePhoto(TimestampMixin, Base):
    """A photo of the book exchange: the book a reader received (or gave),
    shown on the round's results page for the circle to see.

    One per reader per pair; a new photo replaces the old. Sending one also
    confirms the exchange, as the checkbox does. The founder can hide a
    photo from the results in the admin without deleting it.
    """

    __tablename__ = "exchange_photos"
    __table_args__ = (UniqueConstraint("pair_id", "user_id", name="uq_exchange_photos_pair_user"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pair_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("book_exchange_pairs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # "giver" | "receiver": which side of the pair took it.
    role: Mapped[str] = mapped_column(String(10), nullable=False)
    # A data URL, as the market keeps its photos (app/core/photos.py).
    photo: Mapped[str] = mapped_column(Text, nullable=False)
    caption: Mapped[str | None] = mapped_column(String(200), nullable=True, default=None)
    hidden: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
