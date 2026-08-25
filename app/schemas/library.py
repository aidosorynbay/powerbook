from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class LibraryBookOut(BaseModel):
    id: uuid.UUID
    title: str
    author: str | None
    file_format: str
    file_size: int
    cover_data: str | None
    progress_percent: int
    progress_position: str | None
    last_read_at: datetime | None
    is_visible_to_buddies: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class LibraryBookUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    author: str | None = Field(default=None, max_length=200)
    cover_data: str | None = None
    is_visible_to_buddies: bool | None = None


class ProgressUpdate(BaseModel):
    percent: int = Field(ge=0, le=100)
    position: str | None = Field(default=None, max_length=4000)


class LibraryStatsOut(BaseModel):
    total_books: int
    finished_books: int
    in_progress_books: int
    not_started_books: int
    average_percent: int
    storage_used_bytes: int
    storage_quota_bytes: int


class ShelfBookOut(BaseModel):
    """A buddy's book as seen by someone else — metadata and progress only.

    There is deliberately no file reference here: this schema is the reason
    the showcase can't become a download.
    """

    title: str
    author: str | None
    file_format: str
    cover_data: str | None
    progress_percent: int
    last_read_at: datetime | None
