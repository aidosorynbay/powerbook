from __future__ import annotations

from pydantic import BaseModel, Field


class PushKeys(BaseModel):
    p256dh: str = Field(min_length=1, max_length=200)
    auth: str = Field(min_length=1, max_length=100)


class PushSubscriptionIn(BaseModel):
    """What the browser's pushManager.subscribe() returned, as is."""

    endpoint: str = Field(min_length=1, max_length=1000)
    keys: PushKeys


class SubscribeIn(BaseModel):
    subscription: PushSubscriptionIn
    user_agent: str | None = Field(default=None, max_length=300)
    display_mode: str | None = Field(default=None, max_length=20)


class UnsubscribeIn(BaseModel):
    endpoint: str = Field(min_length=1, max_length=1000)


class ReminderIn(BaseModel):
    enabled: bool
    hour: int = Field(ge=0, le=23)
    minute: int = Field(ge=0, le=59)
    tz: str = Field(min_length=1, max_length=64)
    locale: str = Field(default="ru", max_length=5)


class ReminderOut(BaseModel):
    enabled: bool
    hour: int
    minute: int
    tz: str
    locale: str
    # How many browsers of this reader can be reached.
    subscriptions: int
