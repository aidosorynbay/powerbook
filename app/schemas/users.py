from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr

from app.models.enums import Gender, SystemRole


class UserOut(BaseModel):
    id: uuid.UUID
    email: EmailStr
    display_name: str
    gender: Gender | None
    telegram_id: str | None = None
    system_role: SystemRole
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

