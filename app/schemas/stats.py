from __future__ import annotations

from pydantic import BaseModel


class PublicStatsOut(BaseModel):
    """Public statistics for the homepage."""

    total_participants: int
    total_hours_read: int
    total_minutes_read: int
    total_participations: int
    total_rounds: int
    current_round_participants: int
    days_remaining: int
    round_progress_percent: int
    is_round_active: bool

    # Current round's window, so the homepage can announce it ("15–30 August")
    # without a second request. None when there is no current round.
    round_year: int | None = None
    round_month: int | None = None
    round_start_day: int | None = None
    round_end_day: int | None = None
    round_is_partial: bool = False
    round_registration_open: bool = False

    # Year-by-year growth, oldest first — drives the "how we grew" timeline
    yearly: list["YearlyStatOut"] = []


class YearlyStatOut(BaseModel):
    """One year of community history, aggregated."""

    year: int
    readers: int
    minutes: int
    entries: int


class PublicCalendarOut(BaseModel):
    """Anonymous per-day activity for one year: date -> participant count."""

    year: int
    days: dict[str, int]
    peak: int
    active_days: int
