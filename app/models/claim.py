from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum as SAEnum, ForeignKey, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import ClaimStatus
from app.models.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User


class UsernameClaim(TimestampMixin, Base):
    """
    A real user's claim that an archive/ghost account (created by the
    historical import) is actually them. Non-destructive: the original
    reading_logs/round_participants rows keep pointing at ghost_user_id,
    they're just folded into claimant_user_id's stats at read time while
    status=approved. Revoking is instant and lossless.
    """

    __tablename__ = "username_claims"

    __table_args__ = (
        UniqueConstraint("claimant_user_id", "ghost_user_id", name="uq_username_claims_claimant_ghost"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)

    claimant_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    ghost_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    status: Mapped[ClaimStatus] = mapped_column(
        SAEnum(ClaimStatus, name="claim_status"), nullable=False, default=ClaimStatus.pending
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    reviewed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    claimant: Mapped["User"] = relationship(foreign_keys=[claimant_user_id])
    ghost: Mapped["User"] = relationship(foreign_keys=[ghost_user_id])
    reviewed_by: Mapped["User | None"] = relationship(foreign_keys=[reviewed_by_user_id])
