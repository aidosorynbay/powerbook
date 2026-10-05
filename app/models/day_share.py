from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import Date, ForeignKey, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import TimestampMixin


class DayShare(TimestampMixin, Base):
    """A reader sending their reading day out of PowerBook: to WhatsApp,
    Telegram, anywhere — the way runners post a run from Strava.

    It does two jobs. It opens the reader's day page (/r/<username>) to people
    without an account: nobody's minutes are public until they share them
    themselves. And it counts the shares, once per day and channel, so we can
    see whether people share at all, and which way.
    """

    __tablename__ = "day_shares"
    __table_args__ = (UniqueConstraint("user_id", "day", "channel", name="uq_day_shares_user_day_channel"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    round_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("rounds.id", ondelete="CASCADE"), nullable=False, index=True
    )
    day: Mapped[date] = mapped_column(Date, nullable=False)
    # whatsapp | telegram | x | copy | native (the phone's own share sheet)
    channel: Mapped[str] = mapped_column(String(20), nullable=False)
