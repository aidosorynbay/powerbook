"""Reading leagues: how steadily a reader reads, worn as a bookmark.

A circle is measured the way the circle itself counts — a day scores at 30
minutes, and the last day (kept for corrections) is left out. The share of
scored days gives the circle's level:

    bronze 50%+ · silver 70%+ · gold 86%+ · diamond 96%+ (28 of 29 in September)

The league a reader holds during a circle comes from replaying every finished
circle of the group, oldest first, through a few rules:

- up at once: a circle above the league lifts it straight to that level;
- down gently: the first weak circle only warns, every further weak circle
  in a row takes one step off;
- a circle not read (not in it, or under half the days) counts as weak, and
  three of those in a row leave the leagues altogether;
- diamond opens from a reader's third circle (archive circles since 2021
  count), so one strong month does not outrank years of reading;
- ex libris is three diamond circles in a row; it is held while the reader
  keeps reading at diamond level and falls by the same rules.

Bookmarks once held stay in the reader's collection for good; the league is
only ever the current one. Nothing here touches the circle's table, points or
winners. Claimed archive nicknames bring their circles along, so a reader of
five years is a reader of five years.

All readers are computed at once and kept for a few minutes: the board of a
circle asks for every participant, and history only changes when a circle
closes or a nickname is claimed.
"""
from __future__ import annotations

import math
import time
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.constants import DEFAULT_GROUP_SLUG, ROUND_TZ
from app.models.claim import UsernameClaim
from app.models.enums import ClaimStatus, RoundStatus
from app.models.group import Group
from app.models.round import ReadingLog, Round, RoundParticipant

TIERS = ["bronze", "silver", "gold", "diamond", "exlibris"]
# Share of a circle's days needed for each level (index 1..4).
THRESHOLDS = {1: 0.50, 2: 0.70, 3: 0.86, 4: 0.96}
DIAMOND_FROM_CIRCLE = 3
EXLIBRIS_RUN = 3
INACTIVE_OUT = 3
# Leagues switch on with the first circle most readers logged on the site
# (October 2026); before its results are out nobody wears one.
LEAGUES_FROM: tuple[int, int] | None = (2026, 10)
_DONE = (RoundStatus.closed, RoundStatus.results_published)
_TTL = 300.0


def tier_key(level: int) -> str | None:
    return TIERS[level - 1] if level > 0 else None


def scoring_days(rnd: Round) -> list[date]:
    """The days a circle counts: every day of its window but the last."""
    return [d for d in rnd.day_list if d != rnd.last_day_date]


def days_for(level: int, total: int) -> int:
    """Scored days a circle of `total` days needs for a level."""
    return math.ceil(THRESHOLDS[level] * total - 1e-9)


def level_of(scored: int, total: int) -> int:
    if total <= 0:
        return 0
    share = scored / total
    level = 0
    for lv in (1, 2, 3, 4):
        if share + 1e-9 >= THRESHOLDS[lv]:
            level = lv
    return level


@dataclass
class Held:
    tier: str
    year: int
    month: int


@dataclass
class LeagueState:
    level: int = 0
    weak: int = 0
    idle: int = 0
    diamond_run: int = 0
    circles: int = 0
    since_year: int | None = None
    promoted_round: uuid.UUID | None = None
    last_round: uuid.UUID | None = None
    last_scored: int = 0
    last_total: int = 0
    collection: dict[str, Held] = field(default_factory=dict)


def step(state: LeagueState, *, scored: int, total: int, took_part: bool) -> None:
    """Move a reader's league through one finished circle."""
    before = state.level
    if took_part:
        state.circles += 1
    result = level_of(scored, total) if took_part else 0
    if result == 4 and state.circles < DIAMOND_FROM_CIRCLE:
        result = 3
    state.diamond_run = state.diamond_run + 1 if result == 4 else 0
    if result == 4 and (state.diamond_run >= EXLIBRIS_RUN or before == 5):
        result = 5

    if result > state.level:
        state.level, state.weak = result, 0
    elif result == state.level:
        state.weak = 0
    else:
        state.weak += 1
        if state.weak >= 2:
            state.level = max(0, state.level - 1)

    state.idle = state.idle + 1 if result == 0 else 0
    if state.idle >= INACTIVE_OUT:
        state.level, state.weak = 0, 0


@dataclass
class _Circle:
    rnd: Round
    total: int
    days: list[date]


class _Cache:
    key: tuple | None = None
    at: float = 0.0
    states: dict[uuid.UUID, LeagueState] = {}


def _group_id(db: Session) -> uuid.UUID | None:
    return db.execute(select(Group.id).where(Group.slug == DEFAULT_GROUP_SLUG)).scalar_one_or_none()


def _claim_map(db: Session) -> dict[uuid.UUID, uuid.UUID]:
    rows = db.execute(
        select(UsernameClaim.ghost_user_id, UsernameClaim.claimant_user_id).where(
            UsernameClaim.status == ClaimStatus.approved
        )
    ).all()
    return {g: c for g, c in rows}


def _finished_circles(db: Session, group_id: uuid.UUID) -> list[_Circle]:
    rounds = db.execute(
        select(Round).where(Round.group_id == group_id, Round.status.in_(_DONE)).order_by(Round.year, Round.month)
    ).scalars().all()
    out = []
    for r in rounds:
        days = scoring_days(r)
        if days:
            out.append(_Circle(rnd=r, total=len(days), days=days))
    return out


def live(db: Session) -> bool:
    """Whether leagues are on: the circle they start with has finished."""
    if LEAGUES_FROM is None:
        return True
    group_id = _group_id(db)
    if group_id is None:
        return False
    return any((c.rnd.year, c.rnd.month) >= LEAGUES_FROM for c in _finished_circles(db, group_id))


def compute_all(db: Session) -> dict[uuid.UUID, LeagueState]:
    """Every reader's league after the last finished circle, keyed by the real
    account (archive nicknames folded into whoever claimed them)."""
    group_id = _group_id(db)
    if group_id is None:
        return {}
    circles = _finished_circles(db, group_id)
    if LEAGUES_FROM is not None and not any((c.rnd.year, c.rnd.month) >= LEAGUES_FROM for c in circles):
        return {}
    claims = _claim_map(db)
    key = (tuple(c.rnd.id for c in circles), hash(frozenset(claims.items())))
    if _Cache.key == key and time.monotonic() - _Cache.at < _TTL:
        return _Cache.states
    if not circles:
        return {}

    ids = [c.rnd.id for c in circles]
    who = lambda uid: claims.get(uid, uid)  # noqa: E731

    took_part: dict[uuid.UUID, set[uuid.UUID]] = defaultdict(set)
    for rid, uid in db.execute(
        select(RoundParticipant.round_id, RoundParticipant.user_id).where(RoundParticipant.round_id.in_(ids))
    ).all():
        took_part[rid].add(who(uid))

    window = {c.rnd.id: (c.days[0], c.days[-1]) for c in circles}
    scored: dict[tuple[uuid.UUID, uuid.UUID], set[date]] = defaultdict(set)
    for rid, uid in db.execute(
        select(ReadingLog.round_id, ReadingLog.user_id).where(
            ReadingLog.round_id.in_(ids), ReadingLog.minutes > 0
        )
    ).all():
        took_part[rid].add(who(uid))
    for rid, uid, d in db.execute(
        select(ReadingLog.round_id, ReadingLog.user_id, ReadingLog.date).where(
            ReadingLog.round_id.in_(ids), ReadingLog.score == 1
        )
    ).all():
        lo, hi = window[rid]
        if lo <= d <= hi:
            scored[(rid, who(uid))].add(d)

    first_circle: dict[uuid.UUID, int] = {}
    for i, c in enumerate(circles):
        for person in took_part[c.rnd.id]:
            first_circle.setdefault(person, i)

    states: dict[uuid.UUID, LeagueState] = {}
    for person, start in first_circle.items():
        st = LeagueState(since_year=circles[start].rnd.year)
        for c in circles[start:]:
            joined = person in took_part[c.rnd.id]
            n = len(scored.get((c.rnd.id, person), ()))
            before = st.level
            step(st, scored=n, total=c.total, took_part=joined)
            st.last_round, st.last_scored, st.last_total = c.rnd.id, n, c.total
            st.promoted_round = c.rnd.id if st.level > before else None
            # reaching a league earns every bookmark below it too, dated when first reached
            for lv in range(1, st.level + 1):
                st.collection.setdefault(tier_key(lv), Held(tier_key(lv), c.rnd.year, c.rnd.month))
        states[person] = st

    _Cache.key, _Cache.at, _Cache.states = key, time.monotonic(), states
    return states


def reset_cache() -> None:
    _Cache.key = None


def leagues_by_user(db: Session) -> dict[uuid.UUID, str]:
    """The tier each reader wears beside their name (only readers in a league)."""
    out = {}
    claims = _claim_map(db)
    states = compute_all(db)
    for person, st in states.items():
        if st.level > 0:
            out[person] = tier_key(st.level)
    # a ghost row on a board wears its claimant's league
    for ghost, claimant in claims.items():
        if claimant in out:
            out[ghost] = out[claimant]
    return out


def _today() -> date:
    return datetime.now(tz=ROUND_TZ).date()


def my_league(db: Session, *, user_id: uuid.UUID, current: Round | None, effective_ids: list[uuid.UUID]) -> dict:
    """What the profile shows: the league, why, what keeps or lifts it this
    circle, and the bookmarks collected so far."""
    on = live(db)
    st = (compute_all(db).get(user_id) if on else None) or LeagueState()
    level = st.level
    last = db.get(Round, st.last_round) if st.last_round else None

    progress = None
    if current is not None and current.status not in _DONE:
        days = scoring_days(current)
        total = len(days)
        today = _today()
        got = set(
            db.execute(
                select(ReadingLog.date).where(
                    ReadingLog.round_id == current.id,
                    ReadingLog.user_id.in_(effective_ids),
                    ReadingLog.score == 1,
                )
            ).scalars().all()
        ) & set(days)
        left = sum(1 for d in days if d >= today and d not in got)
        nxt = None
        top = 4 if st.circles + 1 >= DIAMOND_FROM_CIRCLE else 3
        for lv in range(min(level, 4) + 1, top + 1):
            need = days_for(lv, total) - len(got)
            if need <= left:
                nxt = {"tier": tier_key(lv), "days": max(0, need)}
                break
        keep = None
        if st.weak >= 1 and 0 < level <= 4:
            need = days_for(level, total) - len(got)
            keep = {"tier": tier_key(level), "days": max(0, need), "reachable": need <= left}
        if level == 5 and st.weak >= 1:
            need = days_for(4, total) - len(got)
            keep = {"tier": "exlibris", "days": max(0, need), "reachable": need <= left}
        progress = {
            "round_id": str(current.id),
            "year": current.year,
            "month": current.month,
            "scored": len(got),
            "total": total,
            "left": left,
            "next": nxt,
            "keep": keep,
        }

    order = {t: i for i, t in enumerate(TIERS)}
    return {
        "live": on,
        "tier": tier_key(level),
        "warning": st.weak >= 1 and level > 0,
        "since_year": st.since_year,
        "circles": st.circles,
        "diamond_open": st.circles + 1 >= DIAMOND_FROM_CIRCLE,
        "exlibris_in": EXLIBRIS_RUN - st.diamond_run if level == 4 else None,
        "based_on": (
            {"round_id": str(last.id), "year": last.year, "month": last.month, "scored": st.last_scored, "total": st.last_total}
            if last
            else None
        ),
        "promoted_round_id": str(st.promoted_round) if st.promoted_round else None,
        "progress": progress,
        "collection": [
            {"tier": h.tier, "year": h.year, "month": h.month}
            for h in sorted(st.collection.values(), key=lambda h: order[h.tier])
        ],
    }
