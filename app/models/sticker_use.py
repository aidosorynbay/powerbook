from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import Date, ForeignKey, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import TimestampMixin


class StickerUse(TimestampMixin, Base):
    """One time a reader took a story sticker out of «Поделиться днём»: copied
    it, saved it, or shared the whole picture. Every use is a row, so the
    month can show which sticker readers take most (/admin → «Стикеры»).

    Google Analytics counts the same thing, but loses much of it: it holds its
    events for about five seconds, and on an iPhone the reader is already in
    Instagram by then. This request leaves the moment the button is pressed.
    """

    __tablename__ = "sticker_uses"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    round_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("rounds.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # The reading day the sticker shows.
    day: Mapped[date] = mapped_column(Date, nullable=False)
    # sticker (the sticker alone) | story (the whole picture, over the reading room)
    channel: Mapped[str] = mapped_column(String(20), nullable=False)
    # page | shelf | calendar | shelfCalendar
    template: Mapped[str] = mapped_column(String(20), nullable=False)
    # copy | save | download | share
    action: Mapped[str] = mapped_column(String(12), nullable=False)
    # light | dark
    ink: Mapped[str] = mapped_column(String(8), nullable=False)
