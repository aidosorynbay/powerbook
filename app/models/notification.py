from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import TimestampMixin


class BookWatch(TimestampMixin, Base):
    """«Следить за книгой»: a reader waiting for a book to turn up — on the
    bazaar, or finished by someone in the circle who might part with it."""

    __tablename__ = "book_watches"
    __table_args__ = (Index("ix_book_watches_work_key", "work_key"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    # The book's comparison key in the shared library (app.core.booktitles).
    work_key: Mapped[str] = mapped_column(String(120), primary_key=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)


class Notification(TimestampMixin, Base):
    """Something on the site for one reader: the header bell lists these.

    kind: "watch_listing" (a watched book is on the bazaar), "watch_finished"
    (someone in the circle finished it), "wanted_by" (readers are looking
    for a book the reader just finished), "new_review" (someone wrote a
    review of a book). `data` holds what the text and the link need; the
    page words it in the reader's language.
    """

    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_user_created", "user_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(30), nullable=False)
    data: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    # Same thing twice in a day is said once (kind + this key).
    dedupe: Mapped[str | None] = mapped_column(String(200), nullable=True, default=None)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=None)


class NotificationPref(TimestampMixin, Base):
    """A kind of notification a reader turned off (or back on).

    No row means on: everyone hears everything until they say otherwise.
    The bell and the app's pushes follow the same switch.
    """

    __tablename__ = "notification_prefs"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    kind: Mapped[str] = mapped_column(String(30), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False)
