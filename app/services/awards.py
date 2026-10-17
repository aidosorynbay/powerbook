"""Awards: the pins a reader collects in their own profile.

Every award grows out of the circle's own currency, a day of 30+ minutes
(a `reading_logs` row with score 1; a circle's last day never scores), and is
worked out from the whole history, archive circles since 2021 included:
claimed nicknames bring their days along, as in the leagues. An award is
dated on the day it was earned (the 100th day of 30+ minutes, the day a run
reached 30 days in a row, the last day of the fifth perfect circle) and is
written down the first time it is found (`reader_awards`): from then on it
stays, whatever later happens to the logs.

Awards are private: they show in the reader's own profile and travel only
when the reader shares one. The tracks follow what the community said
matters (poll, 2026-10-16: 93% for consistency) and what the council of
2026-10-18 kept of the first draft:

- days: days of 30+ minutes, from the first one to a thousand, «от строки до
  библиотеки» (the founder's ladder, 2026-10-16);
- streak: days of 30+ minutes in a row («свет, который не гаснет»);
- clean: circles with every day counted;
- together: the shared treasury — every reader whose minutes are in it when
  PowerBook as a whole passes a million, two, three… («тамшыдан көл»);
- a few secrets for real moments, never listed until earned.

Hours, the number of circles and the winning half were dropped: hours grow
from self-reported minutes (a race of volume), the circles repeat the days,
and the winning half already brings a real book and means someone else's loss.
A reader may hide the awards (no windows, a quiet line in the profile): the
switch is a `notification_prefs` row of kind "awards".

A reader's own awards are read fresh, so the one earned by today's minutes
shows at once; how many readers hold each award and when the treasury passed
each mark need everyone, and are kept for a few minutes, as the leagues are.
"""
from __future__ import annotations

import time
import uuid
from collections import defaultdict
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import date, datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.constants import DEFAULT_GROUP_SLUG, ROUND_TZ
from app.models.award import ReaderAward
from app.models.claim import UsernameClaim
from app.models.clan_war import ClanWar, ClanWarMember
from app.models.enums import ClaimStatus, RoundStatus
from app.models.group import Group
from app.models.notification import NotificationPref
from app.models.round import ReadingLog, Round, RoundParticipant
from app.services import streaks



@dataclass(frozen=True)
class Award:
    key: str
    track: str
    target: int = 1
    secret: bool = False


# The order here is the order of the showcase.
TRACKS: dict[str, list[int]] = {
    # days of 30+ minutes, the ladder from a line to a library
    "days": [1, 30, 100, 200, 365, 500, 1000],
    # days of 30+ minutes in a row (a circle's last day neither counts nor breaks it); four steps, not six
    # (council, 2026-10-18): fewer and further apart, and Kazakh has one word for candle and lamp
    "streak": [7, 30, 100, 365],
    # circles with every day counted
    "clean": [1, 3, 5, 10, 20],
    # millions of minutes in the shared treasury
    "together": [1, 2, 3, 5, 10],
}
SPECIAL = ["book_day", "new_year", "full_year", "comeback", "first_year", "war_1"]

CATALOG: list[Award] = [Award(f"{track}_{n}", track, n) for track, ns in TRACKS.items() for n in ns] + [
    Award(k, "special", 1, secret=True) for k in SPECIAL
]
BY_KEY = {a.key: a for a in CATALOG}

FIRST_YEAR = 2021  # the first circles, in the Telegram days
MILLION = 1_000_000
_DONE = (RoundStatus.closed, RoundStatus.results_published)
_TTL = 600.0


@dataclass
class Person:
    """One reader's history, archive nicknames folded in."""

    counted: set[date] = field(default_factory=set)
    minutes: dict[date, int] = field(default_factory=lambda: defaultdict(int))
    circles: set[uuid.UUID] = field(default_factory=set)
    first_log: dict[uuid.UUID, date] = field(default_factory=dict)
    war: list[date] = field(default_factory=list)


@dataclass
class Result:
    earned: dict[str, date]
    values: dict[str, int]


def _today() -> date:
    return datetime.now(tz=ROUND_TZ).date()


def _local(ts: datetime | None) -> datetime | None:
    if ts is None:
        return None
    if ts.tzinfo is None:  # SQLite hands timestamps back without a zone; they were written in UTC
        ts = ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(ROUND_TZ)


def _claims(db: Session) -> dict[uuid.UUID, uuid.UUID]:
    return dict(
        db.execute(
            select(UsernameClaim.ghost_user_id, UsernameClaim.claimant_user_id).where(UsernameClaim.status == ClaimStatus.approved)
        ).all()
    )


def _rounds(db: Session) -> tuple[list[Round], set[uuid.UUID]]:
    group_id = db.execute(select(Group.id).where(Group.slug == DEFAULT_GROUP_SLUG)).scalar_one_or_none()
    rounds = list(db.execute(select(Round).order_by(Round.year, Round.month)).scalars())
    return rounds, {r.id for r in rounds if r.status in _DONE and r.group_id == group_id}


def _load(db: Session, finished: set[uuid.UUID], who: Callable[[uuid.UUID], uuid.UUID], ids: Iterable[uuid.UUID] | None = None) -> dict[uuid.UUID, Person]:
    """Histories folded by `who`; only the accounts in `ids` when given (one reader and their archive nicknames)."""
    only = list(ids) if ids is not None else None

    def where(stmt, col):
        return stmt.where(col.in_(only)) if only is not None else stmt

    people: dict[uuid.UUID, Person] = defaultdict(Person)
    for rid, uid, d, m, s in db.execute(
        where(select(ReadingLog.round_id, ReadingLog.user_id, ReadingLog.date, ReadingLog.minutes, ReadingLog.score), ReadingLog.user_id)
    ).all():
        p = people[who(uid)]
        if m:
            p.minutes[d] += m
            if rid in finished:
                p.circles.add(rid)
                if rid not in p.first_log or d < p.first_log[rid]:
                    p.first_log[rid] = d
        if s == 1:
            p.counted.add(d)
    for rid, uid in db.execute(where(select(RoundParticipant.round_id, RoundParticipant.user_id), RoundParticipant.user_id)).all():
        if rid in finished:
            people[who(uid)].circles.add(rid)

    # the first clan war (October 2026): everyone who signed up, once it began
    war = db.execute(select(ClanWar).order_by(ClanWar.start_date).limit(1)).scalar_one_or_none()
    if war is not None and _today() >= war.start_date:
        for uid, joined in db.execute(
            where(select(ClanWarMember.user_id, ClanWarMember.created_at), ClanWarMember.user_id).where(ClanWarMember.war_id == war.id)
        ).all():
            j = _local(joined)
            people[who(uid)].war.append(max(war.start_date, j.date()) if j else war.start_date)

    return dict(people)


def treasury_marks(db: Session) -> tuple[int, dict[int, date]]:
    """All the minutes ever read together, and the day the treasury passed each million mark."""
    total = 0
    marks: dict[int, date] = {}
    todo = list(TRACKS["together"])
    for d, m in db.execute(select(ReadingLog.date, func.sum(ReadingLog.minutes)).group_by(ReadingLog.date).order_by(ReadingLog.date)).all():
        total += int(m or 0)
        while todo and total >= todo[0] * MILLION:
            marks[todo.pop(0)] = d
    return total, marks


def evaluate(p: Person, rounds: list[Round], neutral: frozenset[date], treasury: tuple[int, dict[int, date]] = (0, {})) -> Result:
    """Which awards this history earns, each with the day it was earned."""
    earned: dict[str, date] = {}
    by_id = {r.id: r for r in rounds}
    counted = sorted(p.counted)

    for n in TRACKS["days"]:
        if len(counted) >= n:
            earned[f"days_{n}"] = counted[n - 1]

    longest, current = streaks.longest_and_current(counted, neutral, _today()) if counted else (0, 0)
    for n, d in streaks.first_reached(counted, TRACKS["streak"], neutral).items():
        earned[f"streak_{n}"] = d

    mine = sorted((by_id[r] for r in p.circles if r in by_id), key=lambda r: (r.year, r.month))
    clean = 0
    for r in mine:
        days = [d for d in r.day_list if d != r.last_day_date]
        if days and all(d in p.counted for d in days):
            clean += 1
            if clean in TRACKS["clean"]:
                earned[f"clean_{clean}"] = r.last_day_date

    # the treasury: a mark passed while the reader's minutes were already in it
    total, marks = treasury
    first_minute = min((d for d, m in p.minutes.items() if m > 0), default=None)
    if first_minute is not None:
        for n, d in marks.items():
            if first_minute <= d:
                earned[f"together_{n}"] = d

    # the secrets
    book_day = [d for d in counted if (d.month, d.day) == (4, 23)]
    if book_day:
        earned["book_day"] = book_day[0]
    new_year = [d for d in counted if (d.month, d.day) == (1, 1)]  # 31 December is a circle's last day and never counts
    if new_year:
        earned["new_year"] = new_year[0]
    months: dict[int, set[int]] = defaultdict(set)
    for d in counted:
        months[d.year].add(d.month)
        if len(months[d.year]) == 12 and "full_year" not in earned:
            earned["full_year"] = d
    for a, b in zip(mine, mine[1:]):
        if (b.year - a.year) * 12 + (b.month - a.month) >= 13:
            earned["comeback"] = p.first_log.get(b.id, b.first_day_date)
            break
    if mine and mine[0].year <= FIRST_YEAR:
        earned["first_year"] = p.first_log.get(mine[0].id, mine[0].first_day_date)
    if p.war:
        earned["war_1"] = min(p.war)

    values = {
        "since": first_minute.year if first_minute else 0,
        "days": len(counted),
        "streak": longest,
        # the run still going: the next streak pin needs a run that long, so progress is measured by it
        "streak_now": current,
        "clean": clean,
        "together": total,
    }
    return Result(earned=earned, values=values)


class _Everyone:
    at: float = 0.0
    holders: dict[str, int] = {}
    treasury: tuple[int, dict[int, date]] = (0, {})


def _everyone(db: Session) -> type[_Everyone]:
    """How many readers hold each award, and the treasury's marks."""
    if _Everyone.at and time.monotonic() - _Everyone.at < _TTL:
        return _Everyone
    claims = _claims(db)
    rounds, finished = _rounds(db)
    people = _load(db, finished, lambda u: claims.get(u, u))
    neutral = streaks.circle_last_days(db)
    treasury = treasury_marks(db)
    holders: dict[str, int] = defaultdict(int)
    for p in people.values():
        if sum(p.minutes.values()) <= 0:
            continue
        for k in evaluate(p, rounds, neutral, treasury).earned:
            holders[k] += 1
    _Everyone.holders, _Everyone.treasury, _Everyone.at = dict(holders), treasury, time.monotonic()
    return _Everyone


def reset_cache() -> None:
    _Everyone.at = 0.0


def of_reader(db: Session, *, user_id: uuid.UUID, effective_ids: list[uuid.UUID]) -> Result:
    """One reader's awards, read fresh (archive nicknames they claimed folded in)."""
    rounds, finished = _rounds(db)
    people = _load(db, finished, lambda u: user_id, effective_ids)
    return evaluate(people.get(user_id, Person()), rounds, streaks.circle_last_days(db), _everyone(db).treasury)


def _held(db: Session, user_id: uuid.UUID) -> dict[str, ReaderAward]:
    return {r.key: r for r in db.execute(select(ReaderAward).where(ReaderAward.user_id == user_id)).scalars()}


def mine(db: Session, *, user_id: uuid.UUID, effective_ids: list[uuid.UUID]) -> dict:
    """The reader's showcase: every award held (with its day and how many readers
    hold it), each track's step and the next one, and which awards are new.
    Awards found for the first time are written down here, and stay."""
    res = of_reader(db, user_id=user_id, effective_ids=effective_ids)
    everyone = _everyone(db)
    held = _held(db, user_id)
    shown_before = any(r.seen_at is not None for r in held.values())

    fresh = [k for k in res.earned if k not in held]
    if fresh:
        for k in fresh:
            db.add(ReaderAward(user_id=user_id, key=k, earned_on=res.earned[k]))
        try:
            db.commit()
        except IntegrityError:  # the same award written by a request a moment earlier: theirs stands
            db.rollback()
        held = _held(db, user_id)

    on = {k: r.earned_on for k, r in held.items()}
    unseen = {k for k, r in held.items() if r.seen_at is None}
    return _showcase(res, everyone, on, unseen, first_time=not shown_before, effective_ids=effective_ids, hidden=is_hidden(db, user_id))


def _showcase(res: Result, everyone: type[_Everyone], on: dict[str, date], unseen: set[str], *, first_time: bool, effective_ids: list[uuid.UUID], hidden: bool) -> dict:
    tracks = []
    for track, ns in TRACKS.items():
        value = res.values.get(track, 0)
        now = res.values.get(f"{track}_now", value)
        unit = MILLION if track == "together" else 1
        tracks.append({"track": track, "value": value, "now": now, "next": next((n for n in ns if n * unit > value), None)})

    earned = [
        {
            "key": a.key,
            "on": on[a.key].isoformat(),
            # never «у 0»: the reader holds it even when the count is a few minutes old
            "holders": max(1, everyone.holders.get(a.key, 0)),
            "new": a.key in unseen,
        }
        for a in CATALOG
        if a.key in on
    ]
    days = res.values.get("days", 0)
    title = next((n for n in reversed(TRACKS["days"]) if days >= n), None)
    return {
        "earned": earned,
        "tracks": tracks,
        "holders": {a.key: everyone.holders.get(a.key, 0) for a in CATALOG if not a.secret},
        "secret_total": sum(1 for a in CATALOG if a.secret),
        "title": f"days_{title}" if title else None,
        "first_time": first_time,
        # the first year with minutes, archive included («с 2021 года»)
        "since": res.values.get("since") or None,
        # an archive nickname is already folded in: no need to suggest claiming one
        "has_archive": len(effective_ids) > 1,
        "hidden": hidden,
    }


def is_hidden(db: Session, user_id: uuid.UUID) -> bool:
    row = db.get(NotificationPref, (user_id, "awards"))
    return row is not None and not row.enabled


def set_hidden(db: Session, *, user_id: uuid.UUID, hidden: bool) -> bool:
    """«Скрыть награды»: no windows, a quiet line in the profile; the awards stay and keep coming."""
    row = db.get(NotificationPref, (user_id, "awards"))
    if row is None:
        db.add(NotificationPref(user_id=user_id, kind="awards", enabled=not hidden))
    else:
        row.enabled = not hidden
    db.commit()
    return hidden


def peek(db: Session, *, user_id: uuid.UUID, effective_ids: list[uuid.UUID]) -> dict:
    """Another reader's awards, for an admin checking them against the old tables: worked out and shown,
    never written down and never marked as seen."""
    res = of_reader(db, user_id=user_id, effective_ids=effective_ids)
    everyone = _everyone(db)
    held = _held(db, user_id)
    on = {k: r.earned_on for k, r in held.items()}
    for k, d in res.earned.items():
        on.setdefault(k, d)
    return _showcase(res, everyone, on, set(), first_time=False, effective_ids=effective_ids, hidden=False)


def mark_seen(db: Session, *, user_id: uuid.UUID, keys: list[str]) -> int:
    """Remember the awards the reader has now been shown, so each is celebrated once."""
    now = datetime.now(timezone.utc)
    marked = 0
    for k, row in _held(db, user_id).items():
        if k in keys and row.seen_at is None:
            row.seen_at = now
            marked += 1
    if marked:
        db.commit()
    return marked
