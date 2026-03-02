from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel

from app.models.enums import Gender, SystemRole


class UserOut(BaseModel):
    id: uuid.UUID
    username: str
    email: str | None = None
    display_name: str
    gender: Gender | None
    telegram_id: str | None = None
    system_role: SystemRole
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

