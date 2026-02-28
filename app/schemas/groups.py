from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.models.enums import RoundParticipantStatus, RoundStatus


class GroupCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    slug: str = Field(min_length=1, max_length=80)


class GroupOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    owner_user_id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class RoundInfo(BaseModel):
    id: uuid.UUID
    year: int
    month: int
    status: RoundStatus
    registration_open_until_day: int
    timezone: str

    model_config = {"from_attributes": True}


class ParticipationInfo(BaseModel):
    is_participant: bool
    status: RoundParticipantStatus | None = None
    joined_at: datetime | None = None


class CurrentRoundStatusOut(BaseModel):
    group_id: uuid.UUID
    group_name: str
    round: RoundInfo | None = None
    participation: ParticipationInfo | None = None
    deadline_utc: str | None = None
    correction_deadline_utc: str | None = None
    next_round: RoundInfo | None = None
    next_round_participation: ParticipationInfo | None = None

