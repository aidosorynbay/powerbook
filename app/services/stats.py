from __future__ import annotations

import calendar
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from sqlalchemy import func, select

from app.core.cache import stats_cache
from app.core.constants import CACHE_KEY_PUBLIC_STATS, DEFAULT_GROUP_SLUG, ROUND_TZ
from app.models.enums import RoundStatus
from app.models.round import ReadingLog
from app.repositories.groups import GroupRepository
from app.repositories.rounds import RoundRepository
from app.repositories.stats import StatsRepository
from app.schemas.stats import PublicCalendarOut, PublicStatsOut, YearlyStatOut


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

        now = datetime.now(tz=ROUND_TZ)

        # Global stats
        total_participants = self.stats_repo.count_total_unique_participants()
        total_participations = self.stats_repo.count_total_participations()
        total_minutes = self.stats_repo.sum_total_reading_minutes()
        total_hours_read = total_minutes // 60

        # Group-specific stats
        total_rounds = 0
        current_round_participants = 0
        days_remaining = 0
        round_progress_percent = 0
        is_round_active = False
        round_year: int | None = None
        round_month: int | None = None
        round_start_day: int | None = None
        round_end_day: int | None = None
        round_is_partial = False
        round_registration_open = False

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
                round_year = current_round.year
                round_month = current_round.month
                round_start_day = max(1, current_round.start_day)
                round_end_day = current_round.last_day_num
                round_is_partial = current_round.is_partial_month
                round_registration_open = (
                    current_round.status == RoundStatus.registration_open
                    and now.day <= current_round.registration_open_until_day
                )
                current_round_participants = self.stats_repo.count_active_participants_in_round(
                    current_round.id
                )

                # Progress across the round's own window, not the calendar
                # month — a mini-round running 15..30 is 16 days long, and on
                # day 20 it is 6/16 done, not 20/31.
                first_day = max(1, current_round.start_day)
                last_day = current_round.last_day_num
                window_len = max(1, last_day - first_day + 1)
                # Before the round opens, elapsed is 0; after it ends, full.
                elapsed = min(max(now.day - first_day + 1, 0), window_len)
                days_remaining = max(0, last_day - now.day)
                round_progress_percent = int((elapsed / window_len) * 100)

        result = PublicStatsOut(
            total_participants=total_participants,
            total_hours_read=total_hours_read,
            total_minutes_read=total_minutes,
            total_participations=total_participations,
            total_rounds=total_rounds,
            current_round_participants=current_round_participants,
            days_remaining=days_remaining,
            round_progress_percent=round_progress_percent,
            is_round_active=is_round_active,
            round_year=round_year,
            round_month=round_month,
            round_start_day=round_start_day,
            round_end_day=round_end_day,
            round_is_partial=round_is_partial,
            round_registration_open=round_registration_open,
            yearly=self._yearly_history(),
        )

        # Cache the result
        stats_cache.set(cache_key, result.model_dump())
        return result

    def _yearly_history(self) -> list[YearlyStatOut]:
        """Readers/minutes per calendar year, oldest first."""
        year_col = func.extract("year", ReadingLog.date).label("yr")
        rows = self.db.execute(
            select(
                year_col,
                func.count(func.distinct(ReadingLog.user_id)).label("readers"),
                func.coalesce(func.sum(ReadingLog.minutes), 0).label("minutes"),
                func.count().label("entries"),
            )
            .group_by(year_col)
            .order_by(year_col)
        ).all()
        return [
            YearlyStatOut(
                year=int(r.yr),
                readers=int(r.readers),
                minutes=int(r.minutes),
                entries=int(r.entries),
            )
            for r in rows
        ]

    def get_public_calendar(self, *, year: int) -> PublicCalendarOut:
        """Per-day participant counts, counts only — safe to serve publicly."""
        cache_key = f"{CACHE_KEY_PUBLIC_STATS}:calendar:{year}"
        cached = stats_cache.get(cache_key)
        if cached is not None:
            return PublicCalendarOut(**cached)

        rows = self.db.execute(
            select(ReadingLog.date, func.count(func.distinct(ReadingLog.user_id)))
            .where(func.extract("year", ReadingLog.date) == year)
            .group_by(ReadingLog.date)
        ).all()

        days = {d.isoformat(): int(c) for d, c in rows}
        result = PublicCalendarOut(
            year=year,
            days=days,
            peak=max(days.values(), default=0),
            active_days=len(days),
        )
        stats_cache.set(cache_key, result.model_dump())

        return result
