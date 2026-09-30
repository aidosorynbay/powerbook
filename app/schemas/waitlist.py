from __future__ import annotations

from pydantic import BaseModel, Field


class OpenRoundOut(BaseModel):
    id: str
    year: int
    month: int
    # The last day sign-up is open, in the circle's own calendar.
    registration_until: str
    days_left: int


class WaitingPersonOut(BaseModel):
    user_id: str
    display_name: str
    avatar_data: str | None


class WaitlistStateOut(BaseModel):
    # "registration": a round can be joined now; "waitlist": the next one can be waited for.
    phase: str
    open_round: OpenRoundOut | None
    # The month in question: the open round's, or the one being waited for.
    year: int
    month: int
    starts_on: str
    count: int
    in_current_round: bool
    in_open_round: bool
    on_waitlist: bool
    # Waited for the round that is now open, and has not taken the place yet.
    waited_for_open: bool
    days_left_in_month: int
    # Readers who came on the waiting list by this reader's link.
    invited: int
    people: list[WaitingPersonOut]
    # The reader's own username, for their invitation link.
    ref: str | None


class WaitlistJoinIn(BaseModel):
    ref: str | None = Field(default=None, max_length=60)
