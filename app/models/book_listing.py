from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import TimestampMixin


class BookListing(TimestampMixin, Base):
    """A book a reader puts up for sale on the book market.

    PowerBook takes no part in the sale: the listing carries the price and
    how to reach the seller, and the two readers settle the rest between
    themselves. Shown on the market and on the seller's profile.
    """

    __tablename__ = "book_listings"
    __table_args__ = (Index("ix_book_listings_status_created", "status", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    seller_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    title: Mapped[str] = mapped_column(String(300), nullable=False)
    author: Mapped[str | None] = mapped_column(String(200), nullable=True, default=None)
    # The book in the shared library, when it is one: its cover and rating come along.
    work_key: Mapped[str | None] = mapped_column(String(120), nullable=True, default=None, index=True)
    # Put up from the seller's shelf: which book there.
    volume_key: Mapped[str | None] = mapped_column(String(80), nullable=True, default=None)

    # Whole tenge; 0 means "free / for exchange".
    price: Mapped[int] = mapped_column(Integer, nullable=False)
    # "new" | "like_new" | "good" | "fair"
    condition: Mapped[str] = mapped_column(String(12), nullable=False, default="good")
    city: Mapped[str | None] = mapped_column(String(80), nullable=True, default=None)
    # A phone or WhatsApp number, or any other way to reach the seller.
    # Their Telegram comes from the profile.
    contact: Mapped[str | None] = mapped_column(String(120), nullable=True, default=None)
    note: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    # A photo of the seller's own copy, a resized JPEG data URL.
    photo: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)

    # "active" | "reserved" | "sold" | "hidden"
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="active")
    sold_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=None)
