from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, SmallInteger, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import TimestampMixin


class PushVapidKey(Base):
    """The one key pair that signs every push this server sends.

    Made on first use and kept here rather than in .env, so a deploy needs
    nothing configured by hand and both workers sign with the same key.
    Browsers tie a subscription to the public key: losing this row would
    silently orphan every subscription.
    """

    __tablename__ = "push_vapid_keys"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    private_pem: Mapped[str] = mapped_column(Text, nullable=False)
    # Base64url of the raw uncompressed EC point, the form the browser wants.
    public_key: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class PushSubscription(TimestampMixin, Base):
    """One browser or installed app that agreed to receive pushes for a reader."""

    __tablename__ = "push_subscriptions"
    __table_args__ = (Index("ix_push_subscriptions_user", "user_id"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    endpoint: Mapped[str] = mapped_column(String(1000), unique=True, nullable=False)
    p256dh: Mapped[str] = mapped_column(String(200), nullable=False)
    auth: Mapped[str] = mapped_column(String(100), nullable=False)
    user_agent: Mapped[str | None] = mapped_column(String(300), nullable=True, default=None)
    # browser / standalone / ios_standalone, as the page reported it.
    display_mode: Mapped[str | None] = mapped_column(String(20), nullable=True, default=None)
    last_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=None)


class ReadingReminder(TimestampMixin, Base):
    """«Напомнить о чтении»: when, in the reader's own time, and in which language.

    One a day at most, and only on a day whose minutes are not in yet.
    """

    __tablename__ = "reading_reminders"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    hour: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=21)
    minute: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    # IANA zone the reader's phone reported, e.g. Asia/Almaty.
    tz: Mapped[str] = mapped_column(String(64), nullable=False, default="Asia/Almaty")
    locale: Mapped[str] = mapped_column(String(5), nullable=False, default="ru")
    # The reader's local date a reminder last went out (or was skipped as
    # already read), so one day gets one.
    last_sent_on: Mapped[date | None] = mapped_column(Date, nullable=True, default=None)
