from __future__ import annotations

import uuid
from datetime import date

from pydantic import BaseModel, Field


class AllTimeProfileOut(BaseModel):
    total_minutes: int
    total_hours: int
    total_days_logged: int
    current_streak_days: int
    longest_streak_days: int
    consistency_percent: int
    rounds_participated: int
    first_round_label: str | None
    books_finished: int


class PercentileOut(BaseModel):
    round_id: str
    round_label: str
    your_score: int
    percentile: int
    rank: int
    total_participants: int


class ArchetypeOut(BaseModel):
    key: str
    params: dict[str, int]
    fun_fact_weekday: int | None = None
    fun_fact_minutes: int | None = None


class BookshelfEntryOut(BaseModel):
    title: str
    date: str
    round_label: str
    # "round" entries come from reading_logs and can't be edited here;
    # "manual" ones the reader added themselves and can remove again.
    source: str = "round"
    id: uuid.UUID | None = None
    author: str | None = None


class ManualBookIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    author: str | None = Field(default=None, max_length=200)
    finished_on: date | None = None


class ManualBookOut(BaseModel):
    id: uuid.UUID
    title: str
    author: str | None = None
    finished_on: date | None = None


class PopularBookOut(BaseModel):
    title: str
    finish_count: int


class ReadingTwinOut(BaseModel):
    user_id: str
    display_name: str
    telegram_id: str | None
    shared_books: list[str]
    match_percent: int


class CelebrityMatchOut(BaseModel):
    name: str
    role: str
    shared_books: list[str]
    match_percent: int


class BadgeOut(BaseModel):
    key: str
    title: str
    description: str
    earned: bool
    progress_current: int
    progress_target: int


class LeagueRoundOut(BaseModel):
    round_id: str
    year: int
    month: int
    scored: int
    total: int


class LeagueGoalOut(BaseModel):
    tier: str
    days: int
    reachable: bool = True


class LeagueProgressOut(LeagueRoundOut):
    left: int
    next: LeagueGoalOut | None = None
    keep: LeagueGoalOut | None = None


class LeagueHeldOut(BaseModel):
    tier: str
    year: int
    month: int


class LeagueOut(BaseModel):
    """The reader's league (bronze → ex libris), why, and the bookmarks kept."""

    live: bool = True
    tier: str | None
    warning: bool
    since_year: int | None
    circles: int
    diamond_open: bool
    exlibris_in: int | None = None
    based_on: LeagueRoundOut | None
    promoted_round_id: str | None
    progress: LeagueProgressOut | None
    collection: list[LeagueHeldOut]


class AwardEarnedOut(BaseModel):
    key: str
    on: date
    holders: int
    new: bool


class AwardTrackOut(BaseModel):
    track: str
    value: int
    # where the reader stands now towards the next pin (the streak still going; elsewhere = value;
    # for "together" the minutes of the whole treasury, its steps counted in millions)
    now: int
    next: int | None


class AwardsOut(BaseModel):
    """The reader's own awards (app/services/awards.py): earned ones with the day
    and how many readers hold them, each track's step, and what is new."""

    earned: list[AwardEarnedOut]
    tracks: list[AwardTrackOut]
    holders: dict[str, int]
    secret_total: int
    title: str | None
    first_time: bool
    since: int | None = None
    has_archive: bool = False
    # «Скрыть награды»: no windows, a quiet line in the profile
    hidden: bool = False


class AwardsSeenIn(BaseModel):
    keys: list[str] = Field(max_length=100)


class AwardsHiddenIn(BaseModel):
    hidden: bool


class WrappedOut(BaseModel):
    year: int
    total_minutes: int
    total_hours: int
    best_month_label: str | None
    best_month_minutes: int
    longest_streak_days: int
    books_finished: int
    percentile_best: int | None
    archetype: ArchetypeOut
    minutes_by_month: list[int]
    rounds_participated: int
    available_years: list[int]
    days_read: int


class HallOfFameEntryOut(BaseModel):
    user_id: str
    display_name: str
    telegram_id: str | None
    value: int
    badge_title: str | None
    badge_milestone: int | None


class HallOfFameCategoryOut(BaseModel):
    key: str
    title: str
    unit: str
    entries: list[HallOfFameEntryOut]


class HallOfFameOut(BaseModel):
    categories: list[HallOfFameCategoryOut]


class BadgeHolderOut(BaseModel):
    user_id: str
    display_name: str
    value: int


class BadgeStatsOut(BaseModel):
    key: str
    holders: int
    total_readers: int
    percent: float
    sample: list[BadgeHolderOut]
    next_threshold: int | None
    next_key: str | None
