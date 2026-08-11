from __future__ import annotations

from pydantic import BaseModel

from app.schemas.insights import BadgeOut


class DirectoryEntryOut(BaseModel):
    user_id: str
    username: str
    display_name: str
    telegram_id: str | None
    avatar_data: str | None
    archetype_title: str | None
    recommendation_text: str | None
    recent_books: list[str]
    badges_earned: int


class PublicProfileOut(BaseModel):
    user_id: str
    username: str
    display_name: str
    telegram_id: str | None
    avatar_data: str | None
    recommendation_text: str | None
    reading_music_url: str | None
    archetype_title: str | None
    total_hours: int
    longest_streak_days: int
    rounds_participated: int
    books_finished: int
    badges_earned: int
    badges: list[BadgeOut]
    recent_books: list[str]
    favorite_books: list[str]
    is_buddy: bool
    is_self: bool


class BuddyOut(BaseModel):
    user_id: str
    username: str
    display_name: str
    telegram_id: str | None
    avatar_data: str | None
    archetype_title: str | None
