from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class SuggestionCreate(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    message: str = Field(min_length=1, max_length=4000)


class SuggestionOut(BaseModel):
    id: uuid.UUID
    name: str | None
    message: str
    author_display_name: str | None
    author_user_id: uuid.UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}

