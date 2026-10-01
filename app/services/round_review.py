"""A reader's round, looked back on after it ends.

Each round is measured the way the round itself counts — a day scores at 30
minutes (reading_logs.MIN_SCORING_MINUTES) — and set beside the reader's own
past rounds: the one before, the average of all of them, their best. From
the shape of the month come the plain observations: what went well, where
the days were lost (a weak weekday, a fading second half, short days that
never reached the goal, long gaps), and for each weak spot a few habits
readers use against exactly that. The words live in the frontend's i18n
(review.*); this module only decides which apply and with what numbers.

History counts in full: a member's claimed archive nicknames bring their
older rounds along, so a reader of five years is compared with five years.
"""
from __future__ import annotations

import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.constants import ROUND_TZ
from app.models.enums import RoundParticipantStatus, RoundStatus
from app.models.round import ReadingLog, Round, RoundParticipant, RoundResult
from app.models.user import User
from app.repositories.claims import ClaimsRepository
from app.repositories.reading_logs import MIN_SCORING_MINUTES
from app.schemas.round_review import (
    InsightOut,
    RoundBestOut,
    RoundRefOut,
    RoundReviewOut,
    RoundStatsOut,
    TrendPointOut,
)
from app.services import llm

# Below this a day was not a reading day at all, the same line the calendar draws.
_TOUCHED = 2
_MAX_IMPROVE = 4
_MAX_TIPS = 5
_DEFAULT_TIPS = ("reading_room", "phone_away", "before_sleep", "track_pages")


@dataclass
class _Round:
    rnd: Round
    daily: dict[date, int] = field(default_factory=dict)
    books: int = 0
    result: RoundResult | None = None
    participants: int = 0


def _today() -> date:
    from datetime import datetime

    return datetime.now(tz=ROUND_TZ).date()


def _window(rnd: Round) -> list[date]:
    """The round's days, up to today while it is still running. The last day
    of a round is for corrections only and scores nothing, so it is left out
    of every count, as it is on the round's own calendar."""
    days = [d for d in rnd.day_list if d != rnd.last_day_date]
    if rnd.status not in (RoundStatus.results_published, RoundStatus.closed):
        days = [d for d in days if d <= _today()]
    return days


def _stats(r: _Round) -> RoundStatsOut:
    days = _window(r.rnd)
    minutes = [r.daily.get(d, 0) for d in days]
    goal = [m >= MIN_SCORING_MINUTES for m in minutes]

    longest_streak = run = 0
    for g in goal:
        run = run + 1 if g else 0
        longest_streak = max(longest_streak, run)
    longest_gap = run = 0
    for m in minutes:
        run = run + 1 if m < _TOUCHED else 0
        longest_gap = max(longest_gap, run)

    weekday_sum = [0] * 7
    weekday_n = [0] * 7
    for d, m in zip(days, minutes):
        weekday_sum[d.weekday()] += m
        weekday_n[d.weekday()] += 1
    half = len(days) // 2
    best = max(zip(days, minutes), key=lambda dm: dm[1]) if days else None
    reading = [m for m in minutes if m >= _TOUCHED]
    total = sum(minutes)
    rank = r.result.rank if r.result else None
    participants = r.participants or None
    return RoundStatsOut(
        round_id=str(r.rnd.id),
        year=r.rnd.year,
        month=r.rnd.month,
        ongoing=r.rnd.status not in (RoundStatus.results_published, RoundStatus.closed),
        days=len(days),
        goal_days=sum(goal),
        partial_days=sum(1 for m in minutes if _TOUCHED <= m < MIN_SCORING_MINUTES),
        missed_days=sum(1 for m in minutes if m < _TOUCHED),
        minutes=total,
        avg_minutes=round(sum(reading) / len(reading)) if reading else 0,
        longest_streak=longest_streak,
        longest_gap=longest_gap,
        best_day=best[0].isoformat() if best and best[1] > 0 else None,
        best_day_minutes=best[1] if best else 0,
        books=r.books,
        weekday_minutes=[round(s / n) if n else 0 for s, n in zip(weekday_sum, weekday_n)],
        first_half_minutes=sum(minutes[:half]),
        second_half_minutes=sum(minutes[half:]),
        first_week_goal_days=sum(goal[:7]),
        rank=rank,
        participants=participants,
        group=r.result.group.value if r.result else None,
    )


def _share(s: RoundStatsOut) -> float:
    return s.goal_days / s.days if s.days else 0.0


def _insights(cur: RoundStatsOut, past: list[RoundStatsOut]) -> tuple[list[InsightOut], list[InsightOut], list[str]]:
    prev = past[-1] if past else None
    strengths: list[InsightOut] = []
    improve: list[tuple[int, InsightOut]] = []

    def good(key: str, **params: int) -> None:
        strengths.append(InsightOut(key=key, params=params))

    def bad(weight: int, key: str, tips: list[str], **params: int) -> None:
        improve.append((weight, InsightOut(key=key, params=params, tips=tips)))

    # ---- what went well ----
    if cur.days >= 7 and cur.goal_days == cur.days:
        good("perfect", days=cur.days)
    if past and cur.minutes > max(p.minutes for p in past):
        good("record_minutes", minutes=cur.minutes)
    elif past and cur.goal_days < cur.days and _share(cur) > max(_share(p) for p in past) and cur.goal_days > 0:
        good("record_goal", goal=cur.goal_days, days=cur.days)
    if prev and cur.goal_days - prev.goal_days >= 2:
        good("up_from_prev", delta=cur.goal_days - prev.goal_days)
    elif prev and prev.minutes and cur.minutes - prev.minutes >= 120 and cur.minutes >= prev.minutes * 1.2:
        good("minutes_up", pct=round(100 * (cur.minutes - prev.minutes) / prev.minutes))
    if cur.longest_streak >= 7 and cur.goal_days < cur.days:
        good("streak", n=cur.longest_streak)
    if cur.rank and cur.participants and cur.participants >= 5 and cur.rank <= max(1, round(cur.participants * 0.2)):
        good("top", rank=cur.rank, participants=cur.participants)
    if cur.books >= 2:
        good("books", n=cur.books)
    elif cur.books == 1:
        good("book", n=1)
    if not past:
        good("first_round")

    # ---- where the days went ----
    if prev and prev.goal_days - cur.goal_days >= 3:
        bad(9, "down_from_prev", ["look_back", "fixed_slot"], delta=prev.goal_days - cur.goal_days)
    if cur.first_half_minutes >= 150 and cur.second_half_minutes < 0.7 * cur.first_half_minutes:
        drop = round(100 * (1 - cur.second_half_minutes / cur.first_half_minutes))
        bad(8, "fade", ["mid_month", "reading_room"], pct=drop)
    if cur.days >= 14 and cur.first_week_goal_days <= 2 and cur.goal_days - cur.first_week_goal_days >= 5:
        bad(6, "slow_start", ["start_strong"], n=cur.first_week_goal_days)
    if cur.longest_gap >= 3:
        bad(7, "gaps", ["never_twice", "carry_book"], n=cur.longest_gap)
    if cur.partial_days >= 4:
        bad(6, "short_days", ["two_by_fifteen", "reading_room"], n=cur.partial_days)
    if cur.missed_days >= 5 and cur.longest_gap < 3:
        bad(5, "missed", ["carry_book", "audiobooks"], n=cur.missed_days)
    per_day = cur.minutes / cur.days if cur.days else 0
    if per_day >= 10 and cur.days >= 14:
        weakest = min(range(7), key=lambda i: cur.weekday_minutes[i])
        if cur.weekday_minutes[weakest] < 0.5 * per_day:
            tips = ["weekend_plan", "habit_stack"] if weakest >= 5 else ["habit_stack", "fixed_slot"]
            bad(5, "weak_weekday", tips, weekday=weakest, avg=cur.weekday_minutes[weakest])
    if cur.best_day_minutes >= 3 * max(per_day, 1) and cur.best_day_minutes >= 120 and _share(cur) < 0.6:
        bad(4, "binge", ["steady", "fixed_slot"], best=cur.best_day_minutes)
    if cur.books == 0 and cur.minutes >= 600:
        bad(3, "no_book", ["finish_line"])

    improve.sort(key=lambda wi: -wi[0])
    chosen = [i for _, i in improve[:_MAX_IMPROVE]]
    tips: list[str] = []
    for insight in chosen:
        for tip in insight.tips:
            if tip not in tips:
                tips.append(tip)
    for tip in _DEFAULT_TIPS:
        if len(tips) >= _MAX_TIPS:
            break
        if tip not in tips:
            tips.append(tip)
    return strengths, chosen, tips[:_MAX_TIPS]


def _load(db: Session, ids: list[uuid.UUID]) -> list[_Round]:
    # Someone who left before the deadline, or was taken out, did not read the round.
    gone = (RoundParticipantStatus.left_before_deadline, RoundParticipantStatus.removed_by_admin)
    round_ids = {
        rid
        for (rid,) in db.execute(
            select(RoundParticipant.round_id).where(RoundParticipant.user_id.in_(ids), RoundParticipant.status.not_in(gone))
        ).all()
    }
    round_ids |= {rid for (rid,) in db.execute(select(RoundResult.round_id).where(RoundResult.user_id.in_(ids))).all()}
    if not round_ids:
        return []
    rounds = {r.id: _Round(rnd=r) for r in db.execute(select(Round).where(Round.id.in_(round_ids))).scalars().all()}

    daily: dict[uuid.UUID, dict[date, int]] = defaultdict(lambda: defaultdict(int))
    for rid, day, minutes, finished in db.execute(
        select(ReadingLog.round_id, ReadingLog.date, ReadingLog.minutes, ReadingLog.book_finished).where(
            ReadingLog.user_id.in_(ids), ReadingLog.round_id.in_(round_ids)
        )
    ).all():
        daily[rid][day] += minutes or 0
        if finished and rid in rounds:
            rounds[rid].books += 1
    for rid, r in rounds.items():
        r.daily = dict(daily.get(rid, {}))

    for result in db.execute(select(RoundResult).where(RoundResult.user_id.in_(ids), RoundResult.round_id.in_(round_ids))).scalars():
        held = rounds[result.round_id].result
        # Two of one person's accounts in one round cannot happen (claims
        # forbid it), but keep the better placing if the data says otherwise.
        if held is None or result.rank < held.rank:
            rounds[result.round_id].result = result
    for rid, n in db.execute(
        select(RoundResult.round_id, func.count()).where(RoundResult.round_id.in_(round_ids)).group_by(RoundResult.round_id)
    ).all():
        rounds[rid].participants = int(n)
    for rid, n in db.execute(
        select(RoundParticipant.round_id, func.count())
        .where(RoundParticipant.round_id.in_(round_ids))
        .group_by(RoundParticipant.round_id)
    ).all():
        if not rounds[rid].participants:
            rounds[rid].participants = int(n)
    return sorted(rounds.values(), key=lambda r: (r.rnd.year, r.rnd.month, r.rnd.start_day))


def review(db: Session, *, user: User, round_id: uuid.UUID | None = None) -> RoundReviewOut:
    ids = ClaimsRepository(db).effective_user_ids(user_id=user.id)
    history = _load(db, ids)
    if not history:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no_rounds")

    if round_id is not None:
        index = next((i for i, r in enumerate(history) if r.rnd.id == round_id), None)
        if index is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not_in_round")
    else:
        # The last round with results, else the one running now.
        finished = [i for i, r in enumerate(history) if r.result is not None]
        index = finished[-1] if finished else len(history) - 1

    stats = [_stats(r) for r in history[: index + 1]]
    cur, past = stats[-1], [s for s in stats[:-1] if s.days > 0]
    strengths, improve, tips = _insights(cur, past)

    average = None
    if past:
        average = RoundStatsOut(
            round_id="",
            year=0,
            month=0,
            ongoing=False,
            days=round(sum(p.days for p in past) / len(past)),
            goal_days=round(sum(p.goal_days for p in past) / len(past)),
            partial_days=round(sum(p.partial_days for p in past) / len(past)),
            missed_days=round(sum(p.missed_days for p in past) / len(past)),
            minutes=round(sum(p.minutes for p in past) / len(past)),
            avg_minutes=round(sum(p.avg_minutes for p in past) / len(past)),
            longest_streak=round(sum(p.longest_streak for p in past) / len(past)),
            longest_gap=round(sum(p.longest_gap for p in past) / len(past)),
            best_day=None,
            best_day_minutes=0,
            books=round(sum(p.books for p in past) / len(past)),
            weekday_minutes=[round(sum(p.weekday_minutes[i] for p in past) / len(past)) for i in range(7)],
            first_half_minutes=0,
            second_half_minutes=0,
            first_week_goal_days=0,
            rank=None,
            participants=None,
            group=None,
        )

    best = None
    if stats:
        by_minutes = max(stats, key=lambda s: s.minutes)
        by_share = max(stats, key=lambda s: (_share(s), s.goal_days))
        best = RoundBestOut(
            minutes=by_minutes.minutes,
            minutes_year=by_minutes.year,
            minutes_month=by_minutes.month,
            goal_days=by_share.goal_days,
            goal_of=by_share.days,
            goal_year=by_share.year,
            goal_month=by_share.month,
            streak=max(s.longest_streak for s in stats),
        )

    return RoundReviewOut(
        round=cur,
        previous=past[-1] if past else None,
        average=average,
        best=best,
        trend=[
            TrendPointOut(year=s.year, month=s.month, minutes=s.minutes, goal_days=s.goal_days, days=s.days, rank=s.rank, participants=s.participants)
            for s in stats[-8:]
        ],
        rounds=[RoundRefOut(id=str(r.rnd.id), year=r.rnd.year, month=r.rnd.month, has_result=r.result is not None) for r in reversed(history)],
        rounds_count=len([s for s in stats if s.days > 0]),
        strengths=strengths,
        improve=improve,
        tips=tips,
        ai_available=llm.available(),
    )


def letter_input(db: Session, *, user: User, round_id: uuid.UUID) -> dict:
    """What Claude is given to write the round's review: the numbers above
    and the books the reader finished in it, in their own words."""
    data = review(db, user=user, round_id=round_id)
    ids = ClaimsRepository(db).effective_user_ids(user_id=user.id)
    finished = [
        (comment or "").strip()[:400]
        for (comment,) in db.execute(
            select(ReadingLog.comment).where(
                ReadingLog.user_id.in_(ids),
                ReadingLog.round_id == round_id,
                ReadingLog.book_finished.is_(True),
            )
        ).all()
        if comment and comment.strip()
    ]
    cur = data.round.model_dump()
    cur["weekday_minutes_mon_to_sun"] = cur.pop("weekday_minutes")
    return {
        "round": cur,
        "previous_round": data.previous.model_dump() if data.previous else None,
        "average_of_earlier_rounds": data.average.model_dump() if data.average else None,
        "personal_best": data.best.model_dump() if data.best else None,
        "rounds_taken_part_in": data.rounds_count,
        "last_rounds": [t.model_dump() for t in data.trend],
        "noticed_strengths": [s.model_dump() for s in data.strengths],
        "noticed_weak_spots": [i.model_dump() for i in data.improve],
        "books_finished_in_this_round": finished[:20],
        "daily_goal_minutes": MIN_SCORING_MINUTES,
    }
