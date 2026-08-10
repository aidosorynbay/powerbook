from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User


class ReadingBuddy(TimestampMixin, Base):
    """One-directional 'I'm following this reader' relationship. Chat happens
    on Telegram (every user already has a telegram_id) — this table is just
    the bookmark, not a messaging system."""

    __tablename__ = "reading_buddies"

    __table_args__ = (
        UniqueConstraint("user_id", "buddy_user_id", name="uq_reading_buddies_user_buddy"),
        CheckConstraint("user_id <> buddy_user_id", name="ck_reading_buddies_no_self"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    buddy_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    user: Mapped["User"] = relationship(foreign_keys=[user_id])
    buddy: Mapped["User"] = relationship(foreign_keys=[buddy_user_id])
