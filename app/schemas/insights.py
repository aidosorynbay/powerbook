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


class LeagueTierOut(BaseModel):
    round_id: str
    round_label: str
    tier: str
    tier_rank: int
    your_score: int
    members: list[dict]


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
