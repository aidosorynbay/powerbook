from __future__ import annotations

from pydantic import BaseModel


class PublicStatsOut(BaseModel):
    """Public statistics for the homepage."""

    total_participants: int
    total_hours_read: int
    total_rounds: int
    current_round_participants: int
    days_remaining: int
    round_progress_percent: int
    is_round_active: bool
