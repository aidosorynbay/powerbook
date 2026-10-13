"""What the round page's «Мой месяц» panel needs beyond the calendar and the round review (2026-10-13).

The calendar gives the days, the round review the round's shape and its place among the reader's past rounds.
This adds what neither carries: WHEN the reader reads (the hours their reading-room sittings start, the hours
they log their minutes), what the room gave the month, the kudos their days collected, and the records of all
their rounds with a flag for the ones this round has already beaten. One query each, all for the one reader.
"""
from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import date, datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.constants import ROUND_TZ
from app.models.day_share import DayShare
from app.models.reaction import ReadingLogReaction
from app.models.reading_room import ReadingRoomSession
from app.models.round import ReadingLog
from app.models.user import User
from app.repositories.claims import ClaimsRepository
from app.repositories.reading_logs import MIN_SCORING_MINUTES
from app.schemas.my_round import BestDayOut, MyRoundStatsOut, RecordsOut, RoomStatsOut
from app.services import round_review
from app.services.reading_room import reading_day

# A sitting shorter than this is a false start, not reading.
_MIN_SITTING_MINUTES = 3


def _aware(at: datetime) -> datetime:
    """Postgres hands timestamps back with their zone; SQLite (the tests) without one, and those are UTC."""
    return at if at.tzinfo is not None else at.replace(tzinfo=timezone.utc)


def _hour(at: datetime) -> int:
    return _aware(at).astimezone(ROUND_TZ).hour


def my_round_stats(db: Session, *, user: User, round_id: uuid.UUID) -> MyRoundStatsOut:
    ids = ClaimsRepository(db).effective_user_ids(user_id=user.id)

    # ---- when the minutes are logged ----
    log_hours = [0] * 24
    logged_on_the_day = 0
    logged_later = 0
    for day, created in db.execute(
        select(ReadingLog.date, ReadingLog.created_at).where(ReadingLog.user_id.in_(ids), ReadingLog.round_id == round_id)
    ).all():
        if created is None:
            continue
        log_hours[_hour(created)] += 1
        if reading_day(_aware(created)) == day:
            logged_on_the_day += 1
        else:
            logged_later += 1

    # ---- the reading room: sittings this round, the hours they start ----
    sittings = 0
    room_minutes = 0
    longest = 0
    room_hours = [0] * 24
    room_days: set[date] = set()
    for started, seconds, credited, credited_date in db.execute(
        select(
            ReadingRoomSession.created_at,
            ReadingRoomSession.accumulated_seconds,
            ReadingRoomSession.credited_minutes,
            ReadingRoomSession.credited_date,
        ).where(
            ReadingRoomSession.user_id.in_(ids),
            ReadingRoomSession.round_id == round_id,
            ReadingRoomSession.ended_at.is_not(None),
        )
    ).all():
        minutes = int(seconds or 0) // 60
        if minutes < _MIN_SITTING_MINUTES:
            continue
        sittings += 1
        room_minutes += int(credited or 0)
        longest = max(longest, minutes)
        if started is not None:
            room_hours[_hour(started)] += 1
        if credited_date is not None and credited:
            room_days.add(credited_date)

    # ---- kudos and shares ----
    reactions = int(
        db.execute(
            select(func.count(ReadingLogReaction.id))
            .join(ReadingLog, ReadingLog.id == ReadingLogReaction.reading_log_id)
            .where(ReadingLog.user_id.in_(ids), ReadingLog.round_id == round_id)
        ).scalar()
        or 0
    )
    shares = int(
        db.execute(
            select(func.count(DayShare.id)).where(DayShare.user_id.in_(ids), DayShare.round_id == round_id)
        ).scalar()
        or 0
    )

    # ---- records over every round the reader took part in, and what this round has beaten ----
    history = round_review._load(db, ids)  # noqa: SLF001 — the review's own loader, the same numbers it shows
    stats = [round_review._stats(r) for r in history]  # noqa: SLF001
    cur = next((s for s in stats if s.round_id == str(round_id)), None)
    past = [s for s in stats if s.round_id != str(round_id) and s.days > 0]

    # the best single day over every round: date and minutes
    daily: dict[date, int] = defaultdict(int)
    for r in history:
        for d, m in r.daily.items():
            daily[d] += m
    best_day = max(daily.items(), key=lambda dm: dm[1]) if daily else None

    # the longest run of counted days over all time, across month borders too
    longest_streak_ever = run = 0
    prev: date | None = None
    for d in sorted(daily):
        if daily[d] < MIN_SCORING_MINUTES:
            continue
        run = run + 1 if prev is not None and (d - prev).days == 1 else 1
        prev = d
        longest_streak_ever = max(longest_streak_ever, run)

    best_round = max(past, key=lambda s: s.minutes) if past else None
    best_goal = max(past, key=lambda s: (s.goal_days / s.days if s.days else 0, s.goal_days)) if past else None
    new_records: list[str] = []
    if cur is not None and past:
        if cur.minutes > max(p.minutes for p in past):
            new_records.append("minutes")
        if cur.goal_days > max(p.goal_days for p in past):
            new_records.append("goal_days")
        if cur.longest_streak > max(p.longest_streak for p in past):
            new_records.append("streak")
        if cur.best_day_minutes > max(p.best_day_minutes for p in past):
            new_records.append("best_day")
        if cur.books > max(p.books for p in past):
            new_records.append("books")

    return MyRoundStatsOut(
        log_hours=log_hours,
        logged_on_the_day=logged_on_the_day,
        logged_later=logged_later,
        room=RoomStatsOut(sittings=sittings, minutes=room_minutes, longest_minutes=longest, hours=room_hours, days=len(room_days)),
        reactions_received=reactions,
        shares=shares,
        records=RecordsOut(
            best_day=BestDayOut(date=best_day[0].isoformat(), minutes=best_day[1]) if best_day and best_day[1] > 0 else None,
            longest_streak=longest_streak_ever,
            best_round_minutes=best_round.minutes if best_round else None,
            best_round_year=best_round.year if best_round else None,
            best_round_month=best_round.month if best_round else None,
            best_goal_days=best_goal.goal_days if best_goal else None,
            best_goal_of=best_goal.days if best_goal else None,
            rounds=len([s for s in stats if s.days > 0]),
            new_this_round=new_records,
        ),
    )
