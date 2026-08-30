from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.models.enums import RoundParticipantStatus, RoundStatus


class RoundCreateRequest(BaseModel):
    group_id: uuid.UUID
    year: int = Field(ge=2000, le=2100)
    month: int = Field(ge=1, le=12)
    timezone: str = "UTC"
    registration_open_until_day: int = Field(default=10, ge=1, le=31)
    # Optional day window — omit for a normal whole-month round
    start_day: int = Field(default=1, ge=1, le=31)
    end_day: int | None = Field(default=None, ge=1, le=31)


class RoundOut(BaseModel):
    id: uuid.UUID
    group_id: uuid.UUID
    year: int
    month: int
    status: RoundStatus
    registration_open_until_day: int
    start_day: int
    end_day: int | None
    timezone: str
    started_at: datetime | None
    closed_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ParticipantOut(BaseModel):
    id: uuid.UUID
    round_id: uuid.UUID
    user_id: uuid.UUID
    status: RoundParticipantStatus
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

