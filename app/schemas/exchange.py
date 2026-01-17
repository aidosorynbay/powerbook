from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel


class ExchangePairOut(BaseModel):
    id: uuid.UUID
    round_id: uuid.UUID
    giver_user_id: uuid.UUID
    receiver_user_id: uuid.UUID
    giver_marked_given_at: datetime | None
    receiver_marked_received_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

