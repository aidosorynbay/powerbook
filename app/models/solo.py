from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import CheckConstraint, Date, ForeignKey, Integer, SmallInteger, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import TimestampMixin


class SoloDay(TimestampMixin, Base):
    """A day read outside the circle: by a reader who is not in this month's circle, or in a month with no circle.

    The founder (2026-10-20): a reader not in the circle gets a dial and a calendar of their own that run alongside
    the circle's, and their minutes go to their book on the shelf. Kept apart from reading_logs on purpose: those
    are the circle's days, and the leaderboard, the streaks and the awards read them.
    """

    __tablename__ = "solo_days"
    __table_args__ = (
        UniqueConstraint("user_id", "date", name="uq_solo_days_user_date"),
        CheckConstraint("minutes >= 0", name="ck_solo_days_minutes_non_negative"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    date: Mapped[date] = mapped_column(Date, nullable=False)
    minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    books: Mapped[list["SoloDayBook"]] = relationship(
        back_populates="day", cascade="all, delete-orphan", order_by="SoloDayBook.position",
    )


class SoloDayBook(TimestampMixin, Base):
    """Which book a solo day's minutes went to, as reading_log_books does for the circle's days: summed over a title
    these are part of «сколько минут ушло на эту книгу» on the shelf (book_time)."""

    __tablename__ = "solo_day_books"
    __table_args__ = (CheckConstraint("minutes >= 0", name="ck_solo_day_books_minutes_non_negative"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    solo_day_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("solo_days.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # the day's reader again, so per-book totals need no join
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    title_norm: Mapped[str] = mapped_column(String(300), nullable=False)
    minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    position: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)

    day: Mapped["SoloDay"] = relationship(back_populates="books")
