from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User


class Suggestion(TimestampMixin, Base):
    """A note dropped in the temporary public suggestion box. Open to anyone
    with the link, logged in or not — name is optional, no moderation flow,
    just a flat list an admin reads through."""

    __tablename__ = "suggestions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)

    name: Mapped[str | None] = mapped_column(String(120), nullable=True, default=None)
    message: Mapped[str] = mapped_column(Text, nullable=False)

    # Set only if the submitter happened to be logged in — never required.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True, default=None
    )
    user: Mapped["User | None"] = relationship(foreign_keys=[user_id])
