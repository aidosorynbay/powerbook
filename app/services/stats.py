from __future__ import annotations

import calendar
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.core.cache import stats_cache
from app.core.constants import CACHE_KEY_PUBLIC_STATS, DEFAULT_GROUP_SLUG
from app.models.enums import RoundStatus
from app.repositories.groups import GroupRepository
from app.repositories.rounds import RoundRepository
from app.repositories.stats import StatsRepository
from app.schemas.stats import PublicStatsOut


class StatsService:
    """Service for computing platform statistics."""

    def __init__(self, db: Session) -> None:
        self.db = db
        self.stats_repo = StatsRepository(db)
        self.groups_repo = GroupRepository(db)
        self.rounds_repo = RoundRepository(db)

    def get_public_stats(self, group_slug: str = DEFAULT_GROUP_SLUG) -> PublicStatsOut:
        """
        Compute public statistics for display on homepage.
        Results are cached in memory for 30 seconds.

        Returns aggregated stats including:
        - Total unique participants ever
        - Total hours read
        - Total rounds conducted
        - Current round info (participants, days remaining, progress)
        """
        # Check cache first
        cache_key = f"{CACHE_KEY_PUBLIC_STATS}:{group_slug}"
        cached = stats_cache.get(cache_key)
        if cached is not None:
            return PublicStatsOut(**cached)

        now = datetime.now(tz=ZoneInfo("UTC"))

        # Global stats
        total_participants = self.stats_repo.count_total_unique_participants()
        total_minutes = self.stats_repo.sum_total_reading_minutes()
        total_hours_read = total_minutes // 60

        # Group-specific stats
        total_rounds = 0
        current_round_participants = 0
        days_remaining = 0
        round_progress_percent = 0
        is_round_active = False

        group = self.groups_repo.get_by_slug(group_slug)
        if group:
            total_rounds = self.stats_repo.count_rounds_for_group(group.id)

            # Current round stats
            current_round = self.rounds_repo.get_by_group_year_month(
                group_id=group.id,
                year=now.year,
                month=now.month,
            )

            if current_round and current_round.status in {
                RoundStatus.registration_open,
                RoundStatus.locked,
            }:
                is_round_active = True
                current_round_participants = self.stats_repo.count_active_participants_in_round(
                    current_round.id
                )

                # Calculate days remaining and progress
                days_in_month = calendar.monthrange(current_round.year, current_round.month)[1]
                current_day = now.day
                days_remaining = max(0, days_in_month - current_day)
                round_progress_percent = int((current_day / days_in_month) * 100)

        result = PublicStatsOut(
            total_participants=total_participants,
            total_hours_read=total_hours_read,
            total_rounds=total_rounds,
            current_round_participants=current_round_participants,
            days_remaining=days_remaining,
            round_progress_percent=round_progress_percent,
            is_round_active=is_round_active,
        )

        # Cache the result
        stats_cache.set(cache_key, result.model_dump())

        return result
