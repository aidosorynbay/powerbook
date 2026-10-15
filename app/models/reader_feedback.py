from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.round import Round
    from app.models.user import User


class ReaderFeedback(TimestampMixin, Base):
    """What a reader thinks of PowerBook, from the small window that comes up
    after a saved day (at most once a month) or from the founder's link
    (/round?feedback=1).

    A mood in one tap, a few words if they like, and a photo of how they
    read. The photo may go on PowerBook's social pages and site only when
    the reader ticked that it may (photo_consent); without the tick it is
    for the team alone. Deleting the account deletes these rows.
    """

    __tablename__ = "reader_feedback"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    round_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("rounds.id", ondelete="SET NULL"), nullable=True, default=None
    )
    # "love" | "ok" | "improve"; None when the reader only wrote or sent a photo.
    mood: Mapped[str | None] = mapped_column(String(10), nullable=True, default=None)
    text: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    # A data URL, as the market and the exchange keep theirs (app/core/photos.py).
    photo: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    photo_consent: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # Where the window came from ("after_save" | "link"), and the language the
    # reader saw it in: the wording of the consent they ticked.
    source: Mapped[str | None] = mapped_column(String(20), nullable=True, default=None)
    locale: Mapped[str | None] = mapped_column(String(5), nullable=True, default=None)

    user: Mapped["User"] = relationship(foreign_keys=[user_id])
    round: Mapped["Round | None"] = relationship(foreign_keys=[round_id])
