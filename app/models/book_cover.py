from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import TimestampMixin


class BookCover(TimestampMixin, Base):
    """What the internet knows about a title: its proper spelling, its
    author, and a picture of its cover.

    Keyed by the comparison key of the title as readers typed it, so every
    shelf that holds "теори игр" shares one lookup instead of asking Google
    once per reader. A miss is remembered too (status "none"), otherwise a
    title nobody has catalogued would be searched again on every visit.
    """

    __tablename__ = "book_covers"

    key: Mapped[str] = mapped_column(String(300), primary_key=True)
    # The cleaned title that was searched for.
    query: Mapped[str] = mapped_column(String(300), nullable=False)
    # "pending" | "found" | "none" | "error"
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="pending")

    # Set only when the match was close enough to trust over the reader's
    # own spelling — a typo fixed, not a different book swapped in.
    title: Mapped[str | None] = mapped_column(String(300), nullable=True, default=None)
    author: Mapped[str | None] = mapped_column(String(200), nullable=True, default=None)

    source: Mapped[str | None] = mapped_column(String(20), nullable=True, default=None)
    source_id: Mapped[str | None] = mapped_column(String(40), nullable=True, default=None)
    # File name under the covers directory; "<name>.jpg" full size and
    # "<name>-s.jpg" the small copy used for spine colours.
    image: Mapped[str | None] = mapped_column(String(60), nullable=True, default=None)

    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=None)
