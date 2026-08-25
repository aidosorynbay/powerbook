from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User


class LibraryBook(TimestampMixin, Base):
    """A file a reader uploaded to their own library, plus where they left off.

    Deliberately *not* a sharing mechanism: the uploaded file is only ever
    served back to the person who uploaded it. Buddies can see that the book
    exists and how far along it is (see `is_visible_to_buddies`), which is the
    social half of the feature, but there is no path that hands someone else's
    file to another account. Keeping it that way is what makes hosting other
    people's books defensible at all.

    Reading position lives on this row rather than in its own table precisely
    because only the owner can ever read the file — there is no second reader
    to track. Storing it server-side is what makes a phone and a laptop pick
    up in the same place.
    """

    __tablename__ = "library_books"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user: Mapped["User"] = relationship(foreign_keys=[user_id])

    title: Mapped[str] = mapped_column(String(300), nullable=False)
    author: Mapped[str | None] = mapped_column(String(200), nullable=True, default=None)

    # "pdf" | "epub"
    file_format: Mapped[str] = mapped_column(String(10), nullable=False)
    # Path relative to the storage root — never a URL, never client-supplied.
    file_key: Mapped[str] = mapped_column(String(500), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Small base64 thumbnail, same approach as user avatars: a cover is a few
    # KB and nobody wants a second storage path for it.
    cover_data: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)

    # Where they stopped. `progress_position` is opaque on purpose — an EPUB
    # CFI string for epub, a page number for pdf — the reader that wrote it is
    # the only thing that needs to parse it.
    progress_percent: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    progress_position: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    last_read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=None)

    # Whether buddies see this title on the reader's shelf at all. Per-book so
    # a private read stays private without hiding the whole library.
    is_visible_to_buddies: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
