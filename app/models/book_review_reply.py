from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Index, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import TimestampMixin


class BookReviewReply(TimestampMixin, Base):
    """A word in the little conversation under a review.

    The thread is flat, like a chat: everyone answers the review, oldest
    first. It goes when the review goes.
    """

    __tablename__ = "book_review_replies"
    __table_args__ = (Index("ix_book_review_replies_review_created", "review_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    review_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("book_reviews.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
