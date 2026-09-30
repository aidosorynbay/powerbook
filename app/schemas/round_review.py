from __future__ import annotations

from pydantic import BaseModel


class RoundStatsOut(BaseModel):
    round_id: str
    year: int
    month: int
    # Still running: counted up to today.
    ongoing: bool
    # The round's scoring days (its last day, for corrections only, is not one).
    days: int
    # Days of 30+ minutes, the round's own score.
    goal_days: int
    # Days read, but under 30 minutes.
    partial_days: int
    missed_days: int
    minutes: int
    # Minutes per day read.
    avg_minutes: int
    longest_streak: int
    longest_gap: int
    best_day: str | None
    best_day_minutes: int
    books: int
    # Average minutes per weekday, Monday first.
    weekday_minutes: list[int]
    first_half_minutes: int
    second_half_minutes: int
    first_week_goal_days: int
    rank: int | None
    participants: int | None
    group: str | None


class InsightOut(BaseModel):
    key: str
    params: dict[str, int] = {}
    # Keys of the habits that help with this, for the weak spots.
    tips: list[str] = []


class RoundBestOut(BaseModel):
    minutes: int
    minutes_year: int
    minutes_month: int
    goal_days: int
    goal_of: int
    goal_year: int
    goal_month: int
    streak: int


class TrendPointOut(BaseModel):
    year: int
    month: int
    minutes: int
    goal_days: int
    days: int
    rank: int | None
    participants: int | None


class RoundRefOut(BaseModel):
    id: str
    year: int
    month: int
    has_result: bool


class RoundReviewOut(BaseModel):
    round: RoundStatsOut
    previous: RoundStatsOut | None
    # The reader's earlier rounds on average.
    average: RoundStatsOut | None
    best: RoundBestOut | None
    trend: list[TrendPointOut]
    rounds: list[RoundRefOut]
    rounds_count: int
    strengths: list[InsightOut]
    improve: list[InsightOut]
    tips: list[str]
    ai_available: bool
