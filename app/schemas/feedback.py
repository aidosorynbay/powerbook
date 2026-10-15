from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, Field


class FeedbackIn(BaseModel):
    mood: Literal["love", "ok", "meh"] | None = None
    text: str | None = Field(default=None, max_length=4000)
    # A data URL the page has already shrunk (app/core/photos.py checks it).
    photo: str | None = None
    photo_consent: bool = False
    round_id: uuid.UUID | None = None
    source: Literal["after_save", "link"] | None = None
    locale: Literal["ru", "kk", "en"] | None = None


class FeedbackOut(BaseModel):
    id: uuid.UUID
