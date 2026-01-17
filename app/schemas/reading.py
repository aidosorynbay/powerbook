from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field


class LogMinutesRequest(BaseModel):
    date: date
    minutes: int = Field(ge=0, le=24 * 60)

