from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User


class BuddyMessage(TimestampMixin, Base):
    """One message between two readers («buddy»), on the site instead of Telegram (2026-10-15).

    A conversation is the pair. Stored on our server in Kazakhstan; seen by the two of them, and by
    the team only inside a complaint (privacy policy, section 6). Deleted with either account.
    """

    __tablename__ = "buddy_messages"
    __table_args__ = (
        Index("ix_buddy_messages_pair", "sender_id", "recipient_id", "created_at"),
        Index("ix_buddy_messages_recipient_unread", "recipient_id", "read_at"),
        CheckConstraint("sender_id <> recipient_id", name="ck_buddy_messages_not_self"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sender_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    recipient_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=None)


class ChatConsent(Base):
    """A reader's yes to private messages with readers: 16 or older, and the words of the consent they
    agreed to (`version`), with the moment — the law wants consent that can be shown (KZ 94-V, Art. 8, 25)."""

    __tablename__ = "chat_consents"

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    version: Mapped[str] = mapped_column(String(20), nullable=False)
    accepted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ChatAccept(Base):
    """«Принять»: `user_id` agreed to hear from `other_id`. Buddy is a one-way follow, so a first message
    from someone you did not add is a request: its words stay hidden until you accept (or add them back)."""

    __tablename__ = "chat_accepts"

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    other_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    accepted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ChatBlock(TimestampMixin, Base):
    """«Заблокировать»: neither of the two can write to the other while it stands."""

    __tablename__ = "chat_blocks"
    __table_args__ = (UniqueConstraint("blocker_id", "blocked_id", name="uq_chat_blocks_pair"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    blocker_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    blocked_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)


class ChatReport(TimestampMixin, Base):
    """«Пожаловаться»: a complaint about a reader in private messages. It carries the latest messages of
    the conversation (`excerpt`), the only way the team sees a conversation; answered within 20 days
    (KZ law on online platforms, Art. 11). status: new → answered."""

    __tablename__ = "chat_reports"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    reporter_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    reported_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    excerpt: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="new")
    answer: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)

    reporter: Mapped["User"] = relationship(foreign_keys=[reporter_id])
    reported: Mapped["User"] = relationship(foreign_keys=[reported_id])
