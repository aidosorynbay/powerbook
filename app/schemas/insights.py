from __future__ import annotations

from pydantic import BaseModel


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
    title: str
    description: str


class BookshelfEntryOut(BaseModel):
    title: str
    date: str
    round_label: str


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
