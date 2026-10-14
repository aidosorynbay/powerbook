from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Uuid,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import TimestampMixin


class ReadingRoomSession(TimestampMixin, Base):
    """One sitting in a reading room: a reader takes a chair with a book, reads (with pauses), and gets up.

    There are two halls. "round" belongs to the current circle and only its participants sit there;
    "library" is open to every reader. When the reader gets up, the reading time goes into their
    «Сегодня» for the circle they are in, and `credited_*` remembers where, so it can be taken back.
    """

    __tablename__ = "reading_room_sessions"
    __table_args__ = (Index("ix_reading_room_sessions_open", "hall", "ended_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    hall: Mapped[str] = mapped_column(String(16), nullable=False)
    # The circle whose room this is ("round" hall only).
    round_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("rounds.id", ondelete="CASCADE"), nullable=True
    )
    seat: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    book_title: Mapped[str] = mapped_column(String(200), nullable=False)

    # "reading" or "paused" while seated, "ended" once up.
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="reading")
    # Reading time before the current stretch; the stretch itself runs from run_started_at.
    accumulated_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    run_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # How long the page was silent while the clock ran (a locked screen, another app), set aside until the reader says
    # whether they read through it; it is not in accumulated_seconds until they do.
    away_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    credited_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    credited_round_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    credited_date: Mapped[date | None] = mapped_column(Date, nullable=True)


class ReadingRoomMessage(Base):
    """A line in a hall's chat. The round hall's chat belongs to its circle."""

    __tablename__ = "reading_room_messages"
    __table_args__ = (Index("ix_reading_room_messages_hall_created", "hall", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    hall: Mapped[str] = mapped_column(String(16), nullable=False)
    round_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("rounds.id", ondelete="CASCADE"), nullable=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    text: Mapped[str] = mapped_column(String(300), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class GuestRoomSitting(TimestampMixin, Base):
    """A visitor reading in the library hall without an account, from the front page's «Начать читать».

    Held by a secret the visitor's browser keeps (only its hash is stored). When they sign up or log in they may
    keep it: claiming turns it into one of their own ReadingRoomSession rows, credited like any other sitting.
    """

    __tablename__ = "guest_room_sittings"
    __table_args__ = (
        Index("ix_guest_room_sittings_open", "hall", "ended_at"),
        # one visitor per chair at a time: two taps on the same free chair can't both sit down
        Index(
            "uq_guest_room_sittings_open_seat", "hall", "seat", unique=True,
            postgresql_where=text("ended_at IS NULL"), sqlite_where=text("ended_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    hall: Mapped[str] = mapped_column(String(16), nullable=False)
    seat: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    book_title: Mapped[str] = mapped_column(String(200), nullable=False)
    # which figure sits in the chair: "female", "male" or "unknown" (a lamp and a tag only)
    gender: Mapped[str] = mapped_column(String(8), nullable=False, default="unknown")
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="reading")
    accumulated_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    run_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # a silence while the clock ran (a locked phone beside a paper book), set aside until the visitor says whether
    # they read through it — the same question the members' room asks
    away_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # the reader's own sitting it became, once claimed
    claimed_session_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
