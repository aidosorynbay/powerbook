from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import TimestampMixin


class ReaderAward(TimestampMixin, Base):
    """An award a reader holds, kept for good.

    app/services/awards.py works awards out from the reading logs; the first
    time one is found it is written here with the day it was earned, and from
    then on it stays, whatever happens to the logs later (a corrected day, a
    nickname unlinked by mistake): an award once given is never taken back.
    `seen_at` is when the reader was shown it, so the «новая награда» moment
    happens once, on whichever phone or browser opens next.
    """

    __tablename__ = "reader_awards"
    __table_args__ = (UniqueConstraint("user_id", "key", name="uq_reader_award_user_key"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # an award key from app/services/awards.py CATALOG, e.g. "days_100"
    key: Mapped[str] = mapped_column(String(40), nullable=False)
    earned_on: Mapped[date] = mapped_column(Date, nullable=False)
    seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=None)
