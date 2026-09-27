from __future__ import annotations

import calendar
import statistics
import uuid
from collections import defaultdict
from datetime import date, timedelta

from app.core.booktitles import canonical_key
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.enums import RoundParticipantStatus
from app.models.manual_book import ManualBook
from app.repositories.claims import ClaimsRepository
from app.repositories.insights import normalize_book_title, InsightsRepository
from app.repositories.results import RoundResultRepository
from app.repositories.rounds import RoundRepository
from app.schemas.insights import (
    BadgeHolderOut,
    BadgeStatsOut,
    AllTimeProfileOut,
    ArchetypeOut,
    BadgeOut,
    BookshelfEntryOut,
    ManualBookIn,
    ManualBookOut,
    CelebrityMatchOut,
    HallOfFameCategoryOut,
    HallOfFameEntryOut,
    HallOfFameOut,
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
            "автостопом по галактике",
            "foundation",
            "основание",
            "superintelligence",
        ],
    },
    {
        "name": "Mark Zuckerberg",
        "role": "Co-founder, Meta",
        "books": [
            "sapiens",
            "сапиенс",
            "the three-body problem",
            "задача трёх тел",
            "the rational optimist",
        ],
    },
    {
        "name": "Warren Buffett",
        "role": "CEO, Berkshire Hathaway",
        "books": [
            "business adventures",
            "the intelligent investor",
            "разумный инвестор",
            "poor charlie's almanack",
        ],
    },
    {
        "name": "Ray Dalio",
        "role": "Founder, Bridgewater Associates",
        "books": [
            "the power of habit",
            "сила привычки",
            "steve jobs",
            "стив джобс",
            "einstein: his life and universe",
            "эйнштейн. его жизнь и вселенная",
        ],
    },
    {
        "name": "Naval Ravikant",
        "role": "Entrepreneur & Investor",
        "books": [
            "the selfish gene",
            "эгоистичный ген",
            "sapiens",
            "сапиенс",
            "antifragile",
            "антихрупкость",
            "man's search for meaning",
            "человек в поисках смысла",
            "influence",
            "психология влияния",
        ],
    },
    {
        "name": "Oprah Winfrey",
        "role": "Media Executive & Book Club Founder",
        "books": [
            "anna karenina",
            "анна каренина",
            "a new earth",
            "the poisonwood bible",
            "beloved",
            "возлюбленная",
        ],
    },
    {
        "name": "Reese Witherspoon",
        "role": "Actor & Founder, Hello Sunshine Book Club",
        "books": [
            "little fires everywhere",
            "where the crawdads sing",
            "там, где раки поют",
            "daisy jones & the six",
        ],
    },
    {
        "name": "LeBron James",
        "role": "NBA Player",
        "books": [
            "decoded",
            "the godfather",
            "крёстный отец",
            "the alchemist",
            "алхимик",
            "the tipping point",
            "переломный момент",
        ],
    },
    {
        "name": "Emma Watson",
        "role": "Actor & Activist",
        "books": [
            "the remains of the day",
            "остаток дня",
            "siddhartha",
            "сиддхартха",
            "a thousand splendid suns",
            "тысяча сияющих солнц",
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

    def _fun_fact_data(self, *, ids: list[uuid.UUID]) -> tuple[int, int] | None:
        """One concrete, personal data point — different for (almost) every
        user, unlike the archetype bucket which many people can share.
        Returns (weekday, minutes) — weekday text is a frontend i18n concern,
        not something the backend should bake into a sentence."""
        daily = self.repo.daily_minutes_all_time(user_ids=ids)
        if not daily:
            return None

        weekday_minutes: dict[int, int] = defaultdict(int)
        weekday_days: dict[int, int] = defaultdict(int)
        for d, m in daily:
            if m > 0:
                weekday_minutes[d.weekday()] += m
                weekday_days[d.weekday()] += 1

        if weekday_minutes:
            fav_weekday = max(weekday_minutes, key=lambda k: weekday_minutes[k])
            if weekday_days[fav_weekday] >= 3:
                return (fav_weekday, weekday_minutes[fav_weekday])
        return None

    def archetype(self, *, user_id: uuid.UUID) -> ArchetypeOut:
        ids = self._effective_ids(user_id)
        daily = self.repo.daily_minutes_all_time(user_ids=ids)
        active = [(d, m) for d, m in daily if m > 0]
        fun_fact = self._fun_fact_data(ids=ids)
        fun_fact_weekday, fun_fact_minutes = fun_fact if fun_fact else (None, None)

        def out(key: str, params: dict[str, int]) -> ArchetypeOut:
            return ArchetypeOut(
                key=key,
                params=params,
                fun_fact_weekday=fun_fact_weekday,
                fun_fact_minutes=fun_fact_minutes,
            )

        if len(active) < 10:
            return out("newcomer", {})

        minutes_list = [m for _, m in active]
        avg_minutes = statistics.mean(minutes_list)
        stdev = statistics.pstdev(minutes_list) if len(minutes_list) > 1 else 0
        burstiness = stdev / avg_minutes if avg_minutes else 0

        weekend_minutes = sum(m for d, m in active if d.weekday() >= 5)
        total_minutes = sum(minutes_list)
        weekend_share = weekend_minutes / total_minutes if total_minutes else 0

        # Books finished per circle participated — a "always finishes what they start" signal
        books = self.repo.finished_book_titles_for_user(user_ids=ids)
        rounds_n = self.repo.rounds_participated_count(user_ids=ids)
        finish_rate = len(books) / rounds_n if rounds_n else 0

        # One weekday dominating the reading pattern, beyond the generic weekend split
        weekday_minutes: dict[int, int] = defaultdict(int)
        weekday_days: dict[int, int] = defaultdict(int)
        for d, m in active:
            weekday_minutes[d.weekday()] += m
            weekday_days[d.weekday()] += 1
        dominant_weekday = None
        if weekday_minutes:
            top_wd = max(weekday_minutes, key=lambda k: weekday_minutes[k])
            if weekday_days[top_wd] >= 3 and weekday_minutes[top_wd] / total_minutes >= 0.40:
                dominant_weekday = top_wd

        # Trend: meaningfully more active in the second half of their history than the first
        midpoint = len(minutes_list) // 2
        first_half_avg = statistics.mean(minutes_list[:midpoint]) if midpoint >= 3 else None
        second_half_avg = statistics.mean(minutes_list[midpoint:]) if midpoint >= 3 else None
        is_leveling_up = (
            first_half_avg is not None and second_half_avg is not None
            and first_half_avg > 0 and second_half_avg >= first_half_avg * 1.3
        )

        # Where inside the month the minutes land. Rounds run by calendar month,
        # so the same three windows mean the same thing for everyone.
        late_minutes = sum(m for d, m in active if d.day >= 21)
        early_minutes = sum(m for d, m in active if d.day <= 10)
        late_share = late_minutes / total_minutes if total_minutes else 0
        early_share = early_minutes / total_minutes if total_minutes else 0

        # Sittings long enough to be a session rather than a check-in.
        long_days = sum(1 for m in minutes_list if m >= 90)
        long_share = long_days / len(minutes_list)

        # Days that land on the daily norm and stop there.
        norm_days = sum(1 for m in minutes_list if 30 <= m <= 39)
        norm_share = norm_days / len(minutes_list)

        # The longest silence in their history, and whether they broke it.
        dates = sorted(d for d, _ in active)
        max_gap = max(
            ((dates[i] - dates[i - 1]).days for i in range(1, len(dates))),
            default=0,
        )
        days_since_last = (date.today() - dates[-1]).days

        profile = self.all_time_profile(user_id=user_id)

        # Ordered rarest first: a reader who fits several of these is told the
        # most particular thing true about them, not the most common one.
        if max_gap >= 90 and days_since_last <= 45 and len(active) >= 20:
            return out("comeback", {"gap_days": max_gap})
        if profile.longest_streak_days >= 60:
            return out("ironclad", {"streak": profile.longest_streak_days})
        if long_share >= 0.25 and profile.consistency_percent < 70:
            return out("deep_diver", {"long_pct": int(round(long_share * 100))})
        if avg_minutes >= 75:
            return out("marathoner", {"avg_minutes": int(avg_minutes)})
        if burstiness < 0.25 and profile.consistency_percent >= 80:
            return out("metronome", {"consistency_pct": profile.consistency_percent})
        if norm_share >= 0.6:
            return out("norm_keeper", {"norm_pct": int(round(norm_share * 100))})
        if late_share >= 0.5:
            return out("deadline_dancer", {"late_pct": int(round(late_share * 100))})
        if early_share >= 0.5:
            return out("fast_starter", {"early_pct": int(round(early_share * 100))})
        if dominant_weekday is not None:
            return out("weekday_loyalist", {"weekday": dominant_weekday})
        if weekend_share >= 0.40:
            return out("weekend_reader", {"weekend_pct": int(round(weekend_share * 100))})
        if finish_rate >= 0.5 and rounds_n >= 3:
            return out("finisher", {"finish_pct": int(round(finish_rate * 100))})
        if len(books) >= 12:
            return out("omnivore", {"books": len(books)})
        if is_leveling_up:
            return out("on_the_rise", {"second_half_avg": int(second_half_avg), "first_half_avg": int(first_half_avg)})
        if profile.consistency_percent >= 85 and burstiness < 0.6:
            return out("steady", {"consistency_pct": profile.consistency_percent})
        if burstiness >= 1.0:
            return out("sprinter", {})
        if avg_minutes < 25 and profile.consistency_percent >= 70:
            return out("slow_burn", {"avg_minutes": int(avg_minutes)})
        if rounds_n >= 24:
            return out("veteran", {"rounds": rounds_n})
        return out("reader", {})

    # ---------- bookshelf ----------

    def bookshelf(self, *, user_id: uuid.UUID) -> list[BookshelfEntryOut]:
        """Books finished in a round, plus whatever the reader added by hand.

        A title can legitimately exist on both sides — someone logs a book
        during a round and later adds it manually, or vice versa. The round
        entry wins: it carries a real date and the round it belongs to, which
        the manual one can't reconstruct.
        """
        ids = self._effective_ids(user_id)
        rows = self.repo.finished_books_for_user(user_ids=ids)

        shelf: list[BookshelfEntryOut] = []
        seen: set[str] = set()
        for comment, d, rnd in rows:
            shelf.append(
                BookshelfEntryOut(
                    title=comment,
                    date=d.isoformat(),
                    round_label=self.repo.round_label(rnd),
                    source="round",
                )
            )
            seen.add(normalize_book_title(comment))

        for book in self.repo.manual_books_for_user(user_ids=ids):
            if book.title_norm in seen:
                continue
            seen.add(book.title_norm)
            shelf.append(
                BookshelfEntryOut(
                    title=book.title,
                    date=book.finished_on.isoformat() if book.finished_on else "",
                    round_label="",
                    source="manual",
                    id=book.id,
                    author=book.author,
                )
            )

        # Newest first, and undated manual entries sink to the bottom rather
        # than sorting as if they were read in year zero.
        shelf.sort(key=lambda e: e.date or "0000-00-00", reverse=True)
        return shelf

    # ---------- manual books ----------

    def manual_books(self, *, user_id: uuid.UUID) -> list[ManualBookOut]:
        return [
            ManualBookOut(id=b.id, title=b.title, author=b.author, finished_on=b.finished_on)
            for b in self.repo.manual_books_for_user(user_ids=self._effective_ids(user_id))
        ]

    def add_manual_book(self, *, user_id: uuid.UUID, payload: ManualBookIn) -> ManualBookOut:
        title = payload.title.strip()
        if not title:
            raise ValueError("empty_title")
        norm = normalize_book_title(title)
        if not norm:
            raise ValueError("empty_title")

        ids = self._effective_ids(user_id)

        # Already on the shelf from a round — nothing to add, and silently
        # accepting it would leave the reader wondering where it went.
        if norm in self.repo.finished_book_titles_for_user(user_ids=ids):
            raise ValueError("duplicate_round")

        if any(b.title_norm == norm for b in self.repo.manual_books_for_user(user_ids=ids)):
            raise ValueError("duplicate_manual")

        book = ManualBook(
            user_id=user_id,
            title=title,
            title_norm=norm,
            author=(payload.author or "").strip() or None,
            finished_on=payload.finished_on,
        )
        self.db.add(book)
        self.db.commit()
        self.db.refresh(book)
        return ManualBookOut(id=book.id, title=book.title, author=book.author, finished_on=book.finished_on)

    def delete_manual_book(self, *, user_id: uuid.UUID, book_id: uuid.UUID) -> bool:
        book = self.repo.manual_book_by_id(book_id=book_id, user_ids=self._effective_ids(user_id))
        if not book:
            return False
        self.db.delete(book)
        self.db.commit()
        return True

    # ---------- popular books ----------

    def popular_books(self, *, limit: int = 10) -> list[PopularBookOut]:
        rows = self.repo.popular_books(limit=limit)
        return [PopularBookOut(title=title, finish_count=count) for title, count in rows]

    # ---------- reading twins ----------

    def reading_twins(self, *, user_id: uuid.UUID, limit: int = 5) -> list[ReadingTwinOut]:
        ids = self._effective_ids(user_id)
        mine = self.repo.matching_book_keys_for_user(user_ids=ids)
        if not mine:
            return []

        # Fold every claimed archive nickname into the reader who owns it,
        # otherwise one person arrives as several half-empty strangers.
        owner_of = self.claims.approved_owner_by_ghost()
        own = set(ids)
        merged: dict[uuid.UUID, set[str]] = defaultdict(set)
        for account_id, books in self.repo.all_users_matching_books(exclude_user_ids=ids).items():
            owner = owner_of.get(account_id, account_id)
            if owner in own:
                continue
            merged[owner] |= books

        display = self.repo.matching_title_display_map(user_ids=ids)

        scored = []
        for other_id, other_books in merged.items():
            shared = mine & other_books
            if not shared:
                continue
            # Share of the smaller shelf rather than of the two combined. The
            # union punished exactly the people this page is for: read two
            # hundred books and every match collapses to a couple of percent.
            overlap = len(shared) / min(len(mine), len(other_books))
            scored.append((other_id, shared, overlap))

        # Evidence first. Two books in common say more about two readers than
        # any ratio does, and a one-book account sharing its only title is a
        # coincidence, not a twin.
        scored.sort(key=lambda x: (-len(x[1]), -x[2]))

        out = []
        for other_id, shared, overlap in scored[:limit]:
            info = self.repo.display_name_and_telegram(user_id=other_id)
            if not info:
                continue
            display_name, telegram_id = info
            out.append(
                ReadingTwinOut(
                    user_id=str(other_id),
                    display_name=display_name,
                    telegram_id=telegram_id,
                    shared_books=sorted(display.get(k, k) for k in shared)[:10],
                    match_percent=max(1, int(round(overlap * 100))),
                )
            )
        return out

    # ---------- celebrity match ----------

    def celebrity_match(self, *, user_id: uuid.UUID) -> list[CelebrityMatchOut]:
        ids = self._effective_ids(user_id)
        mine = self.repo.finished_book_titles_for_user(user_ids=ids)
        out = []
        for entry in CELEBRITY_READING_LISTS:
            celeb_display = {canonical_key(b): b for b in entry["books"] if canonical_key(b)}
            celeb_books = set(celeb_display)
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
                    shared_books=sorted(celeb_display.get(k, k) for k in shared),
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

    def _current_round(self):
        from app.core.constants import DEFAULT_GROUP_SLUG
        from app.services.groups import GroupService

        group_service = GroupService(self.db)
        group = group_service.get_by_slug(slug=DEFAULT_GROUP_SLUG)
        return group_service.get_current_round(group_id=group.id)

    def league(self, *, user_id: uuid.UUID, round_id: uuid.UUID | None) -> LeagueTierOut:
        from app.repositories.participants import RoundParticipantRepository

        ids = self._effective_ids(user_id)
        # Leagues are a live, this-month mechanic — always the actual current
        # circle, never "whichever round you last happened to participate in".
        rnd = self.repo.round_by_id(round_id=round_id) if round_id else self._current_round()
        if rnd is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No active circle this month")

        participants = RoundParticipantRepository(self.db).list_for_round(round_id=rnd.id)
        ids_set = set(ids)
        mine_participant = next((p for p in participants if p.user_id in ids_set), None)
        if mine_participant is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="You are not participating in this circle")

        scores = self.repo.scores_for_round(round_id=rnd.id)
        # Rank everyone actually enrolled in the circle, not just people who
        # already logged a day — otherwise early risers this month look like
        # the only participants and tiers are computed off a tiny sample.
        ranked = sorted(
            ((p.user_id, scores.get(p.user_id, 0)) for p in participants),
            key=lambda x: -x[1],
        )
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

        mine_id = mine_participant.user_id
        my_tier, my_rank = tiers[mine_id]
        members = []
        for uid, (tier, _) in tiers.items():
            if tier != my_tier:
                continue
            info = self.repo.display_name_and_telegram(user_id=uid)
            if info:
                members.append({"user_id": str(uid), "display_name": info[0], "telegram_id": info[1], "score": scores.get(uid, 0)})
        members.sort(key=lambda m: -m["score"])

        return LeagueTierOut(
            round_id=str(rnd.id),
            round_label=self.repo.round_label(rnd),
            tier=my_tier,
            tier_rank=my_rank,
            your_score=scores.get(mine_id, 0),
            members=members[:30],
        )

    # ---------- wrapped ----------

    def _year_totals(self, ids: list[uuid.UUID]) -> dict[int, int]:
        year_totals, _ = self._year_totals_and_days(ids)
        return year_totals

    def _year_totals_and_days(self, ids: list[uuid.UUID]) -> tuple[dict[int, int], dict[int, int]]:
        daily = self.repo.daily_minutes_all_time(user_ids=ids)
        year_totals: dict[int, int] = defaultdict(int)
        days_read: dict[int, int] = defaultdict(int)
        for d, m in daily:
            year_totals[d.year] += m
            if m > 0:
                days_read[d.year] += 1
        return year_totals, days_read

    def _best_year(self, ids: list[uuid.UUID]) -> int | None:
        year_totals = self._year_totals(ids)
        if not year_totals:
            return None
        return max(year_totals, key=lambda y: year_totals[y])

    def wrapped(self, *, user_id: uuid.UUID, year: int | None = None) -> WrappedOut:
        ids = self._effective_ids(user_id)
        year_totals, days_read_by_year = self._year_totals_and_days(ids)
        available_years = sorted(year_totals.keys())
        if year is None:
            # Default to whichever year they actually read the most in —
            # blindly using the current calendar year makes the card look
            # embarrassingly empty for anyone whose best years are behind
            # them or who hasn't logged much yet this year.
            year = (max(year_totals, key=lambda y: year_totals[y]) if year_totals else None) or date.today().year
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

        rounds_this_year = 0
        for rnd_id in self._participated_round_ids(ids):
            rnd = self.repo.round_by_id(round_id=rnd_id)
            if rnd is not None and rnd.year == year:
                rounds_this_year += 1

        minutes_by_month = [by_month.get(m, 0) for m in range(1, 13)]

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
            minutes_by_month=minutes_by_month,
            rounds_participated=rounds_this_year,
            available_years=available_years,
            days_read=days_read_by_year.get(year, 0),
        )

    # ---------- badge rarity ----------

    BADGE_TRACKS = {
        "hours": [10, 50, 100, 500, 1000],
        "streak": [7, 30, 100, 365],
        "rounds": [1, 10, 25, 50],
        "books": [1, 5, 10, 25, 50],
    }

    def badge_stats(self, *, key: str, viewer_id: uuid.UUID) -> BadgeStatsOut:
        """How rare a badge is, and who else holds it.

        A badge only means something relative to everyone else: "100 hours" is
        an achievement or a formality depending on whether ten people or eight
        hundred have done it. The number is computed live rather than stored,
        because the answer moves every day.
        """
        try:
            track, raw = key.rsplit("_", 1)
            threshold = int(raw)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown badge")
        if track not in self.BADGE_TRACKS:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown badge")

        users = self.repo.all_users_with_flags()
        claim_map = self.repo.all_approved_claims()

        def resolve(uid: uuid.UUID) -> uuid.UUID:
            return claim_map.get(uid, uid)

        def merge(raw_values: dict[uuid.UUID, int]) -> dict[uuid.UUID, int]:
            merged: dict[uuid.UUID, int] = defaultdict(int)
            for uid, v in raw_values.items():
                merged[resolve(uid)] += v
            return dict(merged)

        if track == "hours":
            values = {uid: v // 60 for uid, v in merge(self.repo.minutes_by_all_users()).items()}
        elif track == "rounds":
            values = merge(self.repo.rounds_count_by_all_users())
        elif track == "books":
            values = merge(self.repo.books_count_by_all_users())
        else:
            dates_raw = self.repo.logged_dates_by_all_users()
            grouped: dict[uuid.UUID, list] = defaultdict(list)
            for uid, dlist in dates_raw.items():
                grouped[resolve(uid)].extend(dlist)
            values = {
                uid: _longest_and_current_streak(sorted(set(dlist)))[0]
                for uid, dlist in grouped.items()
            }

        holders = [uid for uid, v in values.items() if v >= threshold]
        # One denominator for every track: everyone who has ever logged
        # reading. Counting only people active in this track would make
        # "42% of readers" and "0.1% of readers" mean different populations,
        # so the rarities could not be compared with each other.
        total = sum(1 for v in merge(self.repo.minutes_by_all_users()).values() if v > 0)

        viewer_ids = set(self._effective_ids(viewer_id))
        sample = []
        for uid in sorted(holders, key=lambda u: -values[u])[:24]:
            if uid in viewer_ids:
                continue
            info = users.get(uid)
            if not info:
                continue
            sample.append(BadgeHolderOut(user_id=str(uid), display_name=info[0], value=values[uid]))
            if len(sample) >= 8:
                break

        milestones = self.BADGE_TRACKS[track]
        nxt = next((m for m in milestones if m > threshold), None)

        return BadgeStatsOut(
            key=key,
            holders=len(holders),
            total_readers=total,
            percent=round((len(holders) / total) * 100, 1) if total else 0.0,
            sample=sample,
            next_threshold=nxt,
            next_key=f"{track}_{nxt}" if nxt else None,
        )

    # ---------- hall of fame (public) ----------

    HOUR_MILESTONES = [10, 50, 100, 500, 1000]
    STREAK_MILESTONES = [7, 30, 100, 365]
    ROUND_MILESTONES = [1, 10, 25, 50]
    BOOK_MILESTONES = [1, 5, 10, 25, 50]
    PERFECT_CIRCLE_MILESTONES = [1, 3, 5, 10]

    @staticmethod
    def _highest_tier(value: int, milestones: list[int]) -> int | None:
        tier = None
        for m in milestones:
            if value >= m:
                tier = m
        return tier

    def hall_of_fame(self) -> HallOfFameOut:
        users = self.repo.all_users_with_flags()  # id -> (name, tg, is_claimable)
        claim_map = self.repo.all_approved_claims()  # ghost_id -> claimant_id

        def resolve(uid: uuid.UUID) -> uuid.UUID | None:
            # Claimed ghosts merge into the real account that claimed them.
            # Everyone else — real account or still-unclaimed archive ghost —
            # is shown under their own identity. Historical achievement is
            # real regardless of whether someone has claimed the handle yet;
            # claiming only affects whose *personal* stats it merges into.
            return claim_map.get(uid, uid)

        def merge_sum(raw: dict[uuid.UUID, int]) -> dict[uuid.UUID, int]:
            merged: dict[uuid.UUID, int] = defaultdict(int)
            for uid, v in raw.items():
                target = resolve(uid)
                if target is not None:
                    merged[target] += v
            return dict(merged)

        minutes_merged = merge_sum(self.repo.minutes_by_all_users())
        rounds_merged = merge_sum(self.repo.rounds_count_by_all_users())
        books_merged = merge_sum(self.repo.books_count_by_all_users())

        dates_raw = self.repo.logged_dates_by_all_users()
        dates_merged: dict[uuid.UUID, list] = defaultdict(list)
        for uid, dlist in dates_raw.items():
            target = resolve(uid)
            if target is not None:
                dates_merged[target].extend(dlist)
        streak_merged = {
            uid: _longest_and_current_streak(sorted(set(dlist)))[0] for uid, dlist in dates_merged.items()
        }

        def top_entries(merged: dict[uuid.UUID, int], milestones: list[int], n: int = 5) -> list[HallOfFameEntryOut]:
            ranked = sorted(merged.items(), key=lambda x: -x[1])[:n]
            out = []
            for uid, value in ranked:
                if value <= 0:
                    continue
                info = users.get(uid)
                tier = self._highest_tier(value, milestones)
                out.append(
                    HallOfFameEntryOut(
                        user_id=str(uid),
                        display_name=info[0] if info else "?",
                        telegram_id=info[1] if info else None,
                        value=value,
                        badge_title=None,
                        badge_milestone=tier,
                    )
                )
            return out

        hours_entries = top_entries({uid: v // 60 for uid, v in minutes_merged.items()}, self.HOUR_MILESTONES)
        streak_entries = top_entries(streak_merged, self.STREAK_MILESTONES)
        rounds_entries = top_entries(rounds_merged, self.ROUND_MILESTONES)
        books_entries = top_entries(books_merged, self.BOOK_MILESTONES)

        # Single-record categories: best single day, best single circle —
        # each person's own personal record, ranked against everyone else's.
        rounds_lookup = {r.id: self.repo.round_label(r) for r in self.repo.all_rounds()}
        rows = self.repo.all_reading_rows()  # (user_id, date, minutes, round_id)

        best_day: dict[uuid.UUID, tuple[int, object]] = {}
        month_sums: dict[tuple[uuid.UUID, uuid.UUID], int] = defaultdict(int)
        for uid, d, minutes, round_id in rows:
            target = resolve(uid)
            if target is None:
                continue
            if minutes > best_day.get(target, (0, None))[0]:
                best_day[target] = (minutes, d)
            month_sums[(target, round_id)] += minutes

        best_month: dict[uuid.UUID, tuple[int, uuid.UUID]] = {}
        for (target, round_id), total in month_sums.items():
            if total > best_month.get(target, (0, None))[0]:
                best_month[target] = (total, round_id)

        def top_record_entries(records: dict[uuid.UUID, tuple], label_fn, n: int = 5) -> list[HallOfFameEntryOut]:
            ranked = sorted(records.items(), key=lambda x: -x[1][0])[:n]
            out = []
            for uid, rec in ranked:
                value = rec[0]
                if value <= 0:
                    continue
                info = users.get(uid)
                out.append(
                    HallOfFameEntryOut(
                        user_id=str(uid),
                        display_name=info[0] if info else "?",
                        telegram_id=info[1] if info else None,
                        value=value,
                        badge_title=label_fn(rec),
                        badge_milestone=None,
                    )
                )
            return out

        best_day_entries = top_record_entries(best_day, lambda rec: rec[1].isoformat() if rec[1] else None)
        best_month_entries = top_record_entries(best_month, lambda rec: rounds_lookup.get(rec[1]))

        # Perfect circles: rounds where every single day of the month was
        # hit (30+ min) — a much harder bar than just "participated".
        round_days = {r.id: calendar.monthrange(r.year, r.month)[1] for r in self.repo.all_rounds()}
        perfect_day_counts: dict[tuple[uuid.UUID, uuid.UUID], int] = defaultdict(int)
        for uid, d, minutes, round_id in rows:
            target = resolve(uid)
            if target is None:
                continue
            if minutes >= 30:
                perfect_day_counts[(target, round_id)] += 1

        perfect_circles: dict[uuid.UUID, int] = defaultdict(int)
        for (target, round_id), count in perfect_day_counts.items():
            days_needed = round_days.get(round_id)
            if days_needed and count >= days_needed:
                perfect_circles[target] += 1

        perfect_entries = top_entries(dict(perfect_circles), self.PERFECT_CIRCLE_MILESTONES)

        return HallOfFameOut(
            categories=[
                HallOfFameCategoryOut(key="hours", title="Most hours read", unit="h", entries=hours_entries),
                HallOfFameCategoryOut(key="streak", title="Longest streak", unit="days", entries=streak_entries),
                HallOfFameCategoryOut(key="rounds", title="Most circles completed", unit="circles", entries=rounds_entries),
                HallOfFameCategoryOut(key="books", title="Most books finished", unit="books", entries=books_entries),
                HallOfFameCategoryOut(key="best_day", title="Best single day", unit="min", entries=best_day_entries),
                HallOfFameCategoryOut(key="best_month", title="Best single circle", unit="min", entries=best_month_entries),
                HallOfFameCategoryOut(key="perfect_circles", title="Flawless circles", unit="circles", entries=perfect_entries),
            ]
        )

