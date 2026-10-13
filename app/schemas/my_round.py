from __future__ import annotations

from pydantic import BaseModel


class RoomStatsOut(BaseModel):
    """The reading room's part in the reader's round."""

    sittings: int
    minutes: int
    longest_minutes: int
    # how many sittings began in each hour of the day (Asia/Almaty), 0–23
    hours: list[int]
    days: int


class BestDayOut(BaseModel):
    date: str
    minutes: int


class RecordsOut(BaseModel):
    """The reader's records over every round, and which of them this round has already beaten."""

    best_day: BestDayOut | None
    longest_streak: int
    best_round_minutes: int | None
    best_round_year: int | None
    best_round_month: int | None
    best_goal_days: int | None
    best_goal_of: int | None
    rounds: int
    # 'minutes' | 'goal_days' | 'streak' | 'best_day' | 'books'
    new_this_round: list[str]


class MyRoundStatsOut(BaseModel):
    # how many of this round's days were logged in each hour of the day (Asia/Almaty), 0–23
    log_hours: list[int]
    logged_on_the_day: int
    logged_later: int
    room: RoomStatsOut
    reactions_received: int
    shares: int
    records: RecordsOut
