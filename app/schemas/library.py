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


class CustomShelfOut(BaseModel):
    id: uuid.UUID
    name: str
    position: int

    model_config = {"from_attributes": True}


class ShelfNameIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)


class ShelfOrderIn(BaseModel):
    ids: list[uuid.UUID] = Field(max_length=50)


class PlacementIn(BaseModel):
    # None puts the book back on the unsorted shelf.
    shelf_id: uuid.UUID | None = None


class BookNoteOut(BaseModel):
    id: uuid.UUID
    text: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class BookNoteIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class BookNoteCreate(BookNoteIn):
    volume_key: str = Field(min_length=3, max_length=80)


class BookcaseBookOut(BaseModel):
    """One volume on a reader's bookcase.

    A volume can be finished (a round log or a hand-added entry), readable
    here (an uploaded file), or both at once when the two name the same book.
    Owner-only fields are left empty when someone else is looking.
    """

    key: str
    title: str
    author: str | None
    # The finishing-day comment, when it says more than the title does.
    note: str | None
    # Came from a comment marked private: only its owner ever sees it.
    note_is_private: bool = False
    # "finished" | "reading" | "unread"
    status: str
    # "round" | "manual" | "upload" — where the volume first came from.
    source: str
    finished_on: str | None
    round_year: int | None
    round_month: int | None
    times_finished: int
    # Comparison key used to find other readers of the same book.
    match_key: str | None
    fellow_readers: int

    has_file: bool
    file_format: str | None
    file_size: int | None
    cover_data: str | None
    progress_percent: int
    last_read_at: datetime | None
    # The date the shelf is ordered by: finished on, or last opened / added.
    shelved_on: str | None = None

    # A real cover found online, served from our own domain; the small one
    # is for spine colours. And where the edition was found.
    cover_url: str | None = None
    cover_thumb_url: str | None = None
    source_url: str | None = None

    # Owner only: how the reader has set this book's cover ("auto", "none",
    # "image"), and whether they've corrected it at all.
    cover_mode: str | None = None
    edited: bool = False
    # «Какая это книга?»: the shared-library book the owner said this copy is.
    pinned: bool = False

    # Owner only: the reader's own notes on this book, oldest first.
    notes: list[BookNoteOut] = []

    # The owner's mark out of ten and their review: public, like the shelf.
    rating: int | None = None
    review: str | None = None
    # Owner only: to take the mark back.
    review_id: uuid.UUID | None = None

    # Which of the owner's shelves the book stands on; None is unsorted.
    shelf_id: uuid.UUID | None = None

    # Owner only.
    upload_id: uuid.UUID | None = None
    manual_id: uuid.UUID | None = None
    is_visible_to_buddies: bool | None = None


class BookcaseOwnerOut(BaseModel):
    user_id: str
    username: str
    display_name: str
    avatar_data: str | None
    is_archive: bool


class BookcaseOut(BaseModel):
    owner: BookcaseOwnerOut
    is_self: bool
    books: list[BookcaseBookOut]
    # The owner's shelves, top to bottom, for the bookcase ("sections") view.
    shelves: list[CustomShelfOut] = []


class FellowReaderOut(BaseModel):
    user_id: str
    display_name: str
    avatar_data: str | None
    is_archive: bool
    is_viewer: bool


class CoverOptionOut(BaseModel):
    """An edition a reader can take a cover from."""

    source: str
    volume_id: str
    title: str
    author: str | None
    thumb_url: str


class OverrideTextIn(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    author: str | None = Field(default=None, max_length=200)


class CoverChoiceIn(BaseModel):
    # "auto" — as found; "none" — painted; "pick" — the edition named below.
    mode: str = Field(pattern="^(auto|none|pick)$")
    source: str | None = Field(default=None, max_length=20)
    volume_id: str | None = Field(default=None, max_length=40)
