from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Index, SmallInteger, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import TimestampMixin


class WaitlistEntry(TimestampMixin, Base):
    """A reader waiting for a circle whose sign-up has not opened yet.

    Keyed by the month, not by a round: next month's round only exists from
    the evening of this month's last day, and people start waiting long
    before. When its sign-up opens, the site offers everyone on the list
    their place in one tap; nobody is put into a round without saying yes,
    since a round ends in a book exchange.
    """

    __tablename__ = "round_waitlist"
    __table_args__ = (
        UniqueConstraint("group_id", "year", "month", "user_id", name="uq_round_waitlist_user"),
        Index("ix_round_waitlist_period", "group_id", "year", "month"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    group_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("groups.id", ondelete="CASCADE"), nullable=False
    )
    year: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    month: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Who shared the link they came by, if anyone.
    invited_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, default=None
    )

    # Read in the admin: whose entry, and who brought them.
    user: Mapped["User"] = relationship(foreign_keys=[user_id], viewonly=True)
    inviter: Mapped["User | None"] = relationship(foreign_keys=[invited_by], viewonly=True)
