from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Index, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import TimestampMixin


class Checkin(TimestampMixin, Base):
    """«Хей, как вы, всё ок?» to a reader who has gone quiet in the circle.

    The founder used to watch the circle's table and write in Telegram to
    whoever had not logged for more than three days. Now the site notices
    (app/services/checkins.py), the founder says yes with one tap in the
    morning, and the words go out in his name on the site.

    One per pause: a pause is known by the last day the reader read before
    it (`last_read`), so a reader who comes back and goes quiet again is a
    new pause. status: planned → approved → sent; or skipped (the founder's
    ❌), expired (nobody said yes that day), cancelled (the reader came back
    before it went out).
    """

    __tablename__ = "checkins"
    __table_args__ = (
        UniqueConstraint("user_id", "round_id", "last_read", name="uq_checkins_pause"),
        Index("ix_checkins_status_day", "status", "day"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    round_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("rounds.id", ondelete="CASCADE"), nullable=False
    )
    # The last day read before the pause (the day before the circle began, if never).
    last_read: Mapped[date] = mapped_column(Date, nullable=False)
    # The reading day it was noticed on.
    day: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="planned")
    text: Mapped[str] = mapped_column(Text, nullable=False)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=None)
    # The reader's quick answer: "forgot" | "ok" | "hard" | "out"; None until they tap one.
    answer: Mapped[str | None] = mapped_column(String(10), nullable=True, default=None)
    answered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=None)


class DirectMessage(TimestampMixin, Base):
    """One message in a reader's conversation with the founder.

    Each reader has one conversation (reader_id); the founder and the other
    admins answer in it from /messages. `read_at` is when the other side
    read it. Deleting the account deletes the conversation.
    """

    __tablename__ = "direct_messages"
    __table_args__ = (Index("ix_direct_messages_reader_created", "reader_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    reader_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    author_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    checkin_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("checkins.id", ondelete="SET NULL"), nullable=True, default=None
    )
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=None)
