from __future__ import annotations

import calendar
import statistics
import uuid
from collections import defaultdict
from datetime import date, timedelta

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.enums import RoundParticipantStatus
from app.repositories.claims import ClaimsRepository
from app.repositories.insights import InsightsRepository
from app.repositories.results import RoundResultRepository
from app.repositories.rounds import RoundRepository
from app.schemas.insights import (
    AllTimeProfileOut,
    ArchetypeOut,
    BadgeOut,
    BookshelfEntryOut,
    CelebrityMatchOut,
    LeagueTierOut,
    PercentileOut,
    PopularBookOut,
    ReadingTwinOut,
    WrappedOut,
)

MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

# Curated, publicly-documented reading picks, each sourced from the person's
# own public lists/interviews (Gates Notes, Year of Books, well-reported book
# club picks, frequently-cited all-time favorites). "For fun" comparison, not
# a claim of endorsement — grow this list freely, it's just data.
CELEBRITY_READING_LISTS: list[dict] = [
    {
        "name": "Bill Gates",
        "role": "Co-founder, Microsoft",
        "books": [
            "remarkably bright creatures",
            "clearing the air",
            "who knew",
            "when everyone knows that everyone knows",
            "abundance",
        ],
    },
    {
        "name": "Barack Obama",
        "role": "44th President of the United States",
        "books": [
            "mark twain",
            "the book of records",
            "king of ashes",
            "audition",
        ],
    },
    {
        "name": "Elon Musk",
        "role": "CEO, Tesla / SpaceX",
        "books": [
            "the hitchhiker's guide to the galaxy",
            "foundation",
            "superintelligence",
        ],
    },
    {
        "name": "Mark Zuckerberg",
        "role": "Co-founder, Meta",
        "books": [
            "sapiens",
            "the three-body problem",
            "the rational optimist",
        ],
    },
    {
        "name": "Warren Buffett",
        "role": "CEO, Berkshire Hathaway",
        "books": [
            "business adventures",
            "the intelligent investor",
            "poor charlie's almanack",
        ],
    },
    {
        "name": "Ray Dalio",
        "role": "Founder, Bridgewater Associates",
        "books": [
            "the power of habit",
            "steve jobs",
            "einstein: his life and universe",
        ],
    },
    {
        "name": "Naval Ravikant",
        "role": "Entrepreneur & Investor",
        "books": [
            "the selfish gene",
            "sapiens",
            "antifragile",
            "man's search for meaning",
            "influence",
        ],
    },
    {
        "name": "Oprah Winfrey",
        "role": "Media Executive & Book Club Founder",
        "books": [
            "anna karenina",
            "a new earth",
            "the poisonwood bible",
            "beloved",
        ],
    },
    {
        "name": "Reese Witherspoon",
        "role": "Actor & Founder, Hello Sunshine Book Club",
        "books": [
            "little fires everywhere",
            "where the crawdads sing",
            "daisy jones & the six",
        ],
    },
    {
        "name": "LeBron James",
        "role": "NBA Player",
        "books": [
            "decoded",
            "the godfather",
            "the alchemist",
            "the tipping point",
        ],
    },
    {
        "name": "Emma Watson",
        "role": "Actor & Activist",
        "books": [
            "the remains of the day",
            "siddhartha",
            "a thousand splendid suns",
        ],
    },
]


def _longest_and_current_streak(sorted_dates: list[date]) -> tuple[int, int]:
    if not sorted_dates:
        return 0, 0
    longest = 1
    run = 1
    for i in range(1, len(sorted_dates)):
        if sorted_dates[i] == sorted_dates[i - 1] + timedelta(days=1):
            run += 1
        elif sorted_dates[i] == sorted_dates[i - 1]:
            continue
        else:
            longest = max(longest, run)
            run = 1
    longest = max(longest, run)

    today = date.today()
    last = sorted_dates[-1]
    if (today - last).days > 1:
        current = 0
    else:
        current = 1
        for i in range(len(sorted_dates) - 1, 0, -1):
            if sorted_dates[i] == sorted_dates[i - 1] + timedelta(days=1):
                current += 1
            else:
                break
    return longest, current


class InsightsService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repo = InsightsRepository(db)
        self.claims = ClaimsRepository(db)
        self.rounds = RoundRepository(db)
        self.results = RoundResultRepository(db)

    def _effective_ids(self, user_id: uuid.UUID) -> list[uuid.UUID]:
        return self.claims.effective_user_ids(user_id=user_id)

    # ---------- all-time profile ----------

    def all_time_profile(self, *, user_id: uuid.UUID) -> AllTimeProfileOut:
        ids = self._effective_ids(user_id)
        dates = self.repo.all_logged_dates(user_ids=ids)
        longest, current = _longest_and_current_streak(sorted(set(dates)))

        total_minutes = self.repo.total_minutes_all_time(user_ids=ids)
        total_days_logged = self.repo.total_days_logged(user_ids=ids)
        rounds_participated = self.repo.rounds_participated_count(user_ids=ids)
        first_round = self.repo.first_round_for_user(user_ids=ids)
        books = self.repo.finished_book_titles_for_user(user_ids=ids)

        possible_days = 0
        for rnd_id in self._participated_round_ids(ids):
            rnd = self.repo.round_by_id(round_id=rnd_id)
            if rnd:
                possible_days += calendar.monthrange(rnd.year, rnd.month)[1]
        consistency = int(round((total_days_logged / possible_days) * 100)) if possible_days else 0

        return AllTimeProfileOut(
            total_minutes=total_minutes,
            total_hours=total_minutes // 60,
            total_days_logged=total_days_logged,
            current_streak_days=current,
            longest_streak_days=longest,
            consistency_percent=min(consistency, 100),
            rounds_participated=rounds_participated,
            first_round_label=(f"{MONTHS[first_round.month]} {first_round.year}" if first_round else None),
            books_finished=len(books),
        )

    def _participated_round_ids(self, user_ids: list[uuid.UUID]) -> list[uuid.UUID]:
        from sqlalchemy import select

        from app.models.round import RoundParticipant

        stmt = select(RoundParticipant.round_id).where(RoundParticipant.user_id.in_(user_ids)).distinct()
        return [row[0] for row in self.db.execute(stmt).all()]

    # ---------- percentile ----------

    def percentile(self, *, user_id: uuid.UUID, round_id: uuid.UUID | None) -> PercentileOut:
        ids = self._effective_ids(user_id)
        rnd = self.repo.round_by_id(round_id=round_id) if round_id else self.repo.last_participated_round(user_ids=ids)
        if rnd is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No round found")

        results = self.results.list_for_round_with_user_names(round_id=rnd.id)
        if not results:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Results not published for this round")

        total = len(results)
        ids_set = set(ids)
        mine = next((r for r, _, _ in results if r.user_id in ids_set), None)
        if mine is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="You did not participate in this round")

        better_or_equal = sum(1 for r, _, _ in results if r.total_score <= mine.total_score)
        pct = int(round((better_or_equal / total) * 100))

        return PercentileOut(
            round_id=str(rnd.id),
            round_label=self.repo.round_label(rnd),
            your_score=mine.total_score,
            percentile=pct,
            rank=mine.rank,
            total_participants=total,
        )

    # ---------- archetype ----------

    def archetype(self, *, user_id: uuid.UUID) -> ArchetypeOut:
        ids = self._effective_ids(user_id)
        daily = self.repo.daily_minutes_all_time(user_ids=ids)
        active = [(d, m) for d, m in daily if m > 0]

        if len(active) < 10:
            return ArchetypeOut(
                key="newcomer",
                title="Newcomer",
                description="Just getting started — a few more circles and your reading style will start to show.",
            )

        minutes_list = [m for _, m in active]
        avg_minutes = statistics.mean(minutes_list)
        stdev = statistics.pstdev(minutes_list) if len(minutes_list) > 1 else 0
        burstiness = stdev / avg_minutes if avg_minutes else 0

        weekend_minutes = sum(m for d, m in active if d.weekday() >= 5)
        total_minutes = sum(minutes_list)
        weekend_share = weekend_minutes / total_minutes if total_minutes else 0

        profile = self.all_time_profile(user_id=user_id)

        if avg_minutes >= 75:
            return ArchetypeOut(
                key="marathoner",
                title="Marathoner",
                description=f"You average {int(avg_minutes)} minutes on the days you read — long, immersive sessions rather than quick check-ins.",
            )
        if weekend_share >= 0.40:
            return ArchetypeOut(
                key="weekend_reader",
                title="Weekend Reader",
                description="Your reading clusters around weekends — the weekday grind gives way to real reading time on Sat/Sun.",
            )
        if profile.consistency_percent >= 85 and burstiness < 0.6:
            return ArchetypeOut(
                key="steady",
                title="The Steady One",
                description=f"{profile.consistency_percent}% consistency with very even daily minutes — you show up, every day, like clockwork.",
            )
        if burstiness >= 1.0:
            return ArchetypeOut(
                key="sprinter",
                title="Sprinter",
                description="Big reading days followed by quiet stretches — you read in bursts, not a steady drip.",
            )
        return ArchetypeOut(
            key="reader",
            title="The Reader",
            description="A solid, well-rounded reading habit — no single extreme, just consistent progress.",
        )

    # ---------- bookshelf ----------

    def bookshelf(self, *, user_id: uuid.UUID) -> list[BookshelfEntryOut]:
        ids = self._effective_ids(user_id)
        rows = self.repo.finished_books_for_user(user_ids=ids)
        return [
            BookshelfEntryOut(title=comment, date=d.isoformat(), round_label=self.repo.round_label(rnd))
            for comment, d, rnd in rows
        ]

    # ---------- popular books ----------

    def popular_books(self, *, limit: int = 10) -> list[PopularBookOut]:
        rows = self.repo.popular_books(limit=limit)
        return [PopularBookOut(title=title, finish_count=count) for title, count in rows]

    # ---------- reading twins ----------

    def reading_twins(self, *, user_id: uuid.UUID, limit: int = 5) -> list[ReadingTwinOut]:
        ids = self._effective_ids(user_id)
        mine = self.repo.finished_book_titles_for_user(user_ids=ids)
        if not mine:
            return []
        others = self.repo.all_users_finished_books(exclude_user_ids=ids)

        scored = []
        for other_id, other_books in others.items():
            shared = mine & other_books
            if not shared:
                continue
            union = mine | other_books
            match_pct = int(round((len(shared) / len(union)) * 100)) if union else 0
            scored.append((other_id, shared, match_pct))

        scored.sort(key=lambda x: (-x[2], -len(x[1])))

        out = []
        for other_id, shared, pct in scored[:limit]:
            info = self.repo.display_name_and_telegram(user_id=other_id)
            if not info:
                continue
            display_name, telegram_id = info
            out.append(
                ReadingTwinOut(
                    user_id=str(other_id),
                    display_name=display_name,
                    telegram_id=telegram_id,
                    shared_books=sorted(shared)[:10],
                    match_percent=pct,
                )
            )
        return out

    # ---------- celebrity match ----------

    def celebrity_match(self, *, user_id: uuid.UUID) -> list[CelebrityMatchOut]:
        ids = self._effective_ids(user_id)
        mine = self.repo.finished_book_titles_for_user(user_ids=ids)
        out = []
        for entry in CELEBRITY_READING_LISTS:
            celeb_books = set(entry["books"])
            shared = mine & celeb_books
            if not shared:
                # Only surface a celebrity when there's a genuine overlap —
                # no fixed always-on trio anymore.
                continue
            union = mine | celeb_books
            pct = int(round((len(shared) / len(union)) * 100)) if union else 0
            out.append(
                CelebrityMatchOut(
                    name=entry["name"],
                    role=entry["role"],
                    shared_books=sorted(shared),
                    match_percent=pct,
                )
            )
        out.sort(key=lambda c: -c.match_percent)
        return out[:6]

    # ---------- badges ----------

    def badges(self, *, user_id: uuid.UUID) -> list[BadgeOut]:
        profile = self.all_time_profile(user_id=user_id)
        out = []

        hour_milestones = [10, 50, 100, 500, 1000]
        next_hours = next((m for m in hour_milestones if m > profile.total_hours), hour_milestones[-1])
        for m in hour_milestones:
            out.append(
                BadgeOut(
                    key=f"hours_{m}",
                    title=f"{m}+ hours read",
                    description=f"Log {m} total hours of reading.",
                    earned=profile.total_hours >= m,
                    progress_current=min(profile.total_hours, m),
                    progress_target=m,
                )
            )

        streak_milestones = [7, 30, 100, 365]
        for m in streak_milestones:
            out.append(
                BadgeOut(
                    key=f"streak_{m}",
                    title=f"{m}-day streak",
                    description=f"Hit the daily norm {m} days in a row.",
                    earned=profile.longest_streak_days >= m,
                    progress_current=min(profile.longest_streak_days, m),
                    progress_target=m,
                )
            )

        round_milestones = [1, 10, 25, 50]
        for m in round_milestones:
            out.append(
                BadgeOut(
                    key=f"rounds_{m}",
                    title=f"{m} circle{'s' if m > 1 else ''} completed",
                    description=f"Participate in {m} monthly circles.",
                    earned=profile.rounds_participated >= m,
                    progress_current=min(profile.rounds_participated, m),
                    progress_target=m,
                )
            )

        book_milestones = [1, 5, 10, 25, 50]
        for m in book_milestones:
            out.append(
                BadgeOut(
                    key=f"books_{m}",
                    title=f"{m} book{'s' if m > 1 else ''} finished",
                    description=f"Finish {m} books and log them.",
                    earned=profile.books_finished >= m,
                    progress_current=min(profile.books_finished, m),
                    progress_target=m,
                )
            )

        return out

    # ---------- leagues (computed, not stored) ----------

    def league(self, *, user_id: uuid.UUID, round_id: uuid.UUID | None) -> LeagueTierOut:
        ids = self._effective_ids(user_id)
        rnd = self.repo.round_by_id(round_id=round_id) if round_id else self.repo.last_participated_round(user_ids=ids)
        if rnd is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No round found")

        scores = self.repo.scores_for_round(round_id=rnd.id)
        ids_set = set(ids)
        mine_id = next((uid for uid in scores if uid in ids_set), None)
        if mine_id is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="You did not participate in this round")

        ranked = sorted(scores.items(), key=lambda x: -x[1])
        n = len(ranked)
        tier_size = max(1, n // 3)
        tiers = {}
        for i, (uid, _) in enumerate(ranked):
            if i < tier_size:
                tiers[uid] = ("Gold", 1)
            elif i < tier_size * 2:
                tiers[uid] = ("Silver", 2)
            else:
                tiers[uid] = ("Bronze", 3)

        my_tier, my_rank = tiers[mine_id]
        members = []
        for uid, (tier, _) in tiers.items():
            if tier != my_tier:
                continue
            info = self.repo.display_name_and_telegram(user_id=uid)
            if info:
                members.append({"display_name": info[0], "telegram_id": info[1], "score": scores[uid]})
        members.sort(key=lambda m: -m["score"])

        return LeagueTierOut(
            round_id=str(rnd.id),
            tier=my_tier,
            tier_rank=my_rank,
            your_score=scores[mine_id],
            members=members[:30],
        )

    # ---------- wrapped ----------

    def wrapped(self, *, user_id: uuid.UUID, year: int) -> WrappedOut:
        ids = self._effective_ids(user_id)
        by_month = self.repo.minutes_by_month_for_year(user_ids=ids, year=year)
        total_minutes = sum(by_month.values())
        best_month, best_minutes = (None, 0)
        if by_month:
            best_month = max(by_month, key=lambda m: by_month[m])
            best_minutes = by_month[best_month]

        profile = self.all_time_profile(user_id=user_id)
        arch = self.archetype(user_id=user_id)

        best_pct = None
        for rnd_id in self._participated_round_ids(ids):
            rnd = self.repo.round_by_id(round_id=rnd_id)
            if rnd is None or rnd.year != year:
                continue
            try:
                p = self.percentile(user_id=user_id, round_id=rnd_id)
                best_pct = p.percentile if best_pct is None else max(best_pct, p.percentile)
            except HTTPException:
                continue

        books_this_year = sum(
            1 for _, d, rnd in self.repo.finished_books_for_user(user_ids=ids) if rnd.year == year
        )

        return WrappedOut(
            year=year,
            total_minutes=total_minutes,
            total_hours=total_minutes // 60,
            best_month_label=(MONTHS[best_month] if best_month else None),
            best_month_minutes=best_minutes,
            longest_streak_days=profile.longest_streak_days,
            books_finished=books_this_year,
            percentile_best=best_pct,
            archetype=arch,
        )
