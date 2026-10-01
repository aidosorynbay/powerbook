from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class CatalogItemOut(BaseModel):
    key: str
    title: str
    author: str | None
    cover_url: str | None
    cover_thumb_url: str | None
    readers: int
    # PowerBook: the readers' own marks, out of ten.
    pb_rating: float | None
    pb_votes: int
    pb_reviews: int
    # Elsewhere, on that source's own scale.
    ext_rating: float | None
    ext_scale: int
    ext_votes: int | None
    ext_source: str | None
    for_sale: int
    my_rating: int | None
    topics: list[str] = []


class CatalogCountsOut(BaseModel):
    all: int
    rated: int
    reviewed: int
    sale: int


class CatalogPageOut(BaseModel):
    items: list[CatalogItemOut]
    total: int
    offset: int
    counts: CatalogCountsOut
    topics: dict[str, int]


class ReviewOut(BaseModel):
    id: uuid.UUID
    user_id: str
    display_name: str
    avatar_data: str | None
    rating: int
    text: str | None
    created_at: datetime
    updated_at: datetime
    is_viewer: bool


class WorkReaderOut(BaseModel):
    user_id: str
    display_name: str
    avatar_data: str | None
    is_archive: bool
    is_viewer: bool


class TextWithSourceOut(BaseModel):
    text: str
    source: str
    url: str | None = None


class SellerOut(BaseModel):
    user_id: str
    display_name: str
    avatar_data: str | None = None
    telegram: str | None = None


class ListingOut(BaseModel):
    id: uuid.UUID
    title: str
    author: str | None
    work_key: str | None
    volume_key: str | None
    price: int
    condition: str
    city: str | None
    contact: str | None
    note: str | None
    photo_url: str | None
    cover_url: str | None
    cover_thumb_url: str | None
    status: str
    created_at: datetime
    seller: SellerOut
    is_mine: bool
    # From the shared library, when the book is one of it.
    pb_rating: float | None = None
    ext_rating: float | None = None
    ext_scale: int = 5
    ext_source: str | None = None


class WorkOut(CatalogItemOut):
    ext_url: str | None
    goodreads_url: str | None
    source_url: str | None
    about: TextWithSourceOut | None
    readers_say: TextWithSourceOut | None
    pages: int | None
    year: int | None
    facts_status: str | None
    # How many readers gave each mark, 1..10.
    histogram: list[int]
    reviews: list[ReviewOut]
    readers_list: list[WorkReaderOut]
    my_review: ReviewOut | None
    # The book on the viewer's own shelf, when it is there: marks are given from the shelf.
    my_volume_key: str | None
    listings: list[ListingOut]


class ReviewIn(BaseModel):
    volume_key: str = Field(min_length=3, max_length=80)
    rating: int = Field(ge=1, le=10)
    text: str | None = Field(default=None, max_length=5000)


class ShelfReviewOut(BaseModel):
    id: uuid.UUID
    work_key: str
    volume_key: str | None
    rating: int
    text: str | None
    updated_at: datetime


class ListingIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    author: str | None = Field(default=None, max_length=200)
    price: int = Field(ge=0, le=10_000_000)
    condition: str = Field(default="good", pattern="^(new|like_new|good|fair)$")
    city: str | None = Field(default=None, max_length=80)
    # A phone or WhatsApp number. Required — a buyer must always be able to
    # get in touch — and checked in the service, so a missing one and a
    # malformed one answer alike ("bad_phone").
    contact: str | None = Field(default=None, max_length=120)
    note: str | None = Field(default=None, max_length=1000)
    # A resized JPEG as a data URL; about 600 KB at most.
    photo: str | None = Field(default=None, max_length=900_000)
    volume_key: str | None = Field(default=None, max_length=80)


class ListingPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    author: str | None = Field(default=None, max_length=200)
    price: int | None = Field(default=None, ge=0, le=10_000_000)
    condition: str | None = Field(default=None, pattern="^(new|like_new|good|fair)$")
    city: str | None = Field(default=None, max_length=80)
    contact: str | None = Field(default=None, max_length=120)
    note: str | None = Field(default=None, max_length=1000)
    photo: str | None = Field(default=None, max_length=900_000)
    remove_photo: bool = False
    status: str | None = Field(default=None, pattern="^(active|reserved|sold|hidden)$")


class MarketPageOut(BaseModel):
    items: list[ListingOut]
    total: int
    offset: int
    cities: list[str]


class BookMatchOut(BaseModel):
    """«Какая это книга?»: books of the shared library first, then catalogue editions."""

    works: list[CatalogItemOut]
    editions: list["CoverOptionOut"]


class PinWorkIn(BaseModel):
    # A book of the shared library…
    work_key: str | None = Field(default=None, max_length=120)
    # …or a catalogue edition, with what the search showed of it.
    source: str | None = Field(default=None, max_length=20)
    volume_id: str | None = Field(default=None, max_length=40)
    title: str | None = Field(default=None, max_length=300)
    author: str | None = Field(default=None, max_length=200)


from app.schemas.library import CoverOptionOut  # noqa: E402

BookMatchOut.model_rebuild()
