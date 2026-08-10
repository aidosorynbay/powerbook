from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.round import ReadingLog
    from app.models.user import User


class ReadingLogReaction(TimestampMixin, Base):
    """
    A lightweight "kudos" on a reading log entry - one reaction per
    (reading_log, user). Single-tap toggle in the UI, Strava-kudos style.
    """

    __tablename__ = "reading_log_reactions"

    __table_args__ = (
        UniqueConstraint("reading_log_id", "user_id", name="uq_reading_log_reactions_log_user"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    reading_log_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("reading_logs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    emoji: Mapped[str] = mapped_column(String(8), nullable=False, default="🔥", server_default="🔥")

    reading_log: Mapped["ReadingLog"] = relationship()
    user: Mapped["User"] = relationship()
