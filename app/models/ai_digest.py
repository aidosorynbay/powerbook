from __future__ import annotations

import uuid

from sqlalchemy import JSON, ForeignKey, Index, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import TimestampMixin


class AiDigest(TimestampMixin, Base):
    """What Claude wrote for a reader about their reading: a month or a year
    looked back on, or one book's notes gathered into its main ideas.

    Kept so opening it again costs nothing; written again only when the
    reading behind it changed (input_hash) or the reader asks for a fresh one.
    """

    __tablename__ = "ai_digests"
    __table_args__ = (Index("ix_ai_digests_user_scope", "user_id", "kind", "scope", "lang"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # "period" (scope "2026", "2026-09" or "all") | "book" (scope = volume key)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    scope: Mapped[str] = mapped_column(String(80), nullable=False)
    lang: Mapped[str] = mapped_column(String(4), nullable=False)
    # "working" | "done" | "error"
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="working")
    input_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    content: Mapped[dict | None] = mapped_column(JSON, nullable=True, default=None)
    error: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
