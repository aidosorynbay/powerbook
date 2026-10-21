"""«Битва кланов»: two teams, 14 days, the circle's own days of reading.

- A point: every member who has a scored day (30+ minutes, logged on the
  circle's dial) before 00:00 brings their team one point for that day.
- At 00:00 (Astana) the day is locked: each of the team's points is a book
  put on the team's library shelves. Logs entered after midnight for a locked
  day change nothing.
- The shelves hold a place for every member's every day (members × days), so
  a team of 12 and a team of 10 compete evenly; after the last day the fullest
  library wins. (The fortress numbers — bricks — are kept alongside.)

Members count from the day they joined. Only team numbers are public; a
member sees their own points. Nothing here touches the circle's table.
"""
from __future__ import annotations

import math
import uuid
from datetime import date, datetime, time, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.constants import ROUND_TZ
from app.models.clan_war import ClanWar, ClanWarDay, ClanWarMember, ClanWarRead, ClanWarRoomRead
from app.models.enums import SystemRole
from app.models.round import ReadingLog, Round, RoundParticipant
from app.models.user import User

TEAMS = ["lighthouse", "sail"]
SIGNUP_CLOSES = time(20, 0)  # on the eve of the start, Astana time: the split, then four hours to get ready


def _now() -> datetime:
    return datetime.now(tz=ROUND_TZ)


def signup_deadline(war: ClanWar) -> datetime:
    return datetime.combine(war.start_date - timedelta(days=1), SIGNUP_CLOSES, tzinfo=ROUND_TZ)


def _today() -> date:
    return datetime.now(tz=ROUND_TZ).date()


def _joined_day(m: ClanWarMember, war: ClanWar) -> date:
    created = m.created_at
    if created is None:
        return war.start_date
    if created.tzinfo is None:
        d = created.date()
    else:
        d = created.astimezone(ROUND_TZ).date()
    return max(war.start_date, d)


def current_war(db: Session) -> ClanWar | None:
    return db.execute(select(ClanWar).order_by(ClanWar.start_date.desc())).scalars().first()


def _war_or_404(db: Session) -> ClanWar:
    war = current_war(db)
    if war is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No clan war")
    return war


def _members(db: Session, war: ClanWar) -> list[tuple[ClanWarMember, User, int | None]]:
    rows = db.execute(
        select(ClanWarMember, User, func.length(User.avatar_data))
        .join(User, User.id == ClanWarMember.user_id)
        .where(ClanWarMember.war_id == war.id)
        .order_by(ClanWarMember.created_at)
    ).all()
    return [(m, u, a) for m, u, a in rows]


def _days(war: ClanWar, today: date) -> list[date]:
    last = min(war.end_date, today)
    n = (last - war.start_date).days + 1
    return [war.start_date + timedelta(days=i) for i in range(max(0, n))]


def _on_time(d: date, created: datetime | None) -> bool:
    """A day counts for the war only if it was logged before that day's midnight (Astana).
    A late log still counts for the circle, never for the war."""
    if created is None:
        return True
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    return created < _midnight(d)


def _midnight(d: date) -> datetime:
    """When war day `d` closes: 00:00 (Astana) after it."""
    return datetime.combine(d + timedelta(days=1), time(0, 0), tzinfo=ROUND_TZ)


def _logged(db: Session, user_ids: list[uuid.UUID], war: ClanWar) -> dict[tuple[uuid.UUID, date], int]:
    """Each member's minutes for each war day logged before its own midnight: from the circle's logs, and from
    the war page for guests."""
    if not user_ids:
        return {}
    rows = db.execute(
        select(ReadingLog.user_id, ReadingLog.date, ReadingLog.minutes, ReadingLog.created_at).where(
            ReadingLog.user_id.in_(user_ids),
            ReadingLog.date >= war.start_date,
            ReadingLog.date <= war.end_date,
        )
    ).all()
    guest = db.execute(
        select(ClanWarRead.user_id, ClanWarRead.date, ClanWarRead.minutes, ClanWarRead.created_at).where(
            ClanWarRead.war_id == war.id, ClanWarRead.user_id.in_(user_ids)
        )
    ).all()
    out: dict[tuple[uuid.UUID, date], int] = {}
    for u, d, m, c in [*rows, *guest]:
        if _on_time(d, c):
            out[(u, d)] = max(out.get((u, d), 0), int(m or 0))
    return out


def _room(db: Session, user_ids: list[uuid.UUID], d: date, now: datetime | None = None) -> dict[uuid.UUID, int]:
    """Minutes each member read in the reading room on war day `d` (the calendar day, Astana) that its logs before
    midnight do not hold yet: a sitting still open, one got up from after midnight, or one whose minutes went to
    another day (the room's day turns at 03:00, so 00:10–01:00 is credited to the day before). A sitting the reader
    took back («Отменить») was not reading; a silence they have not answered for stays out, as in the room."""
    if not user_ids:
        return {}
    from app.models.reading_room import ReadingRoomSession
    from app.services.reading_room import AWAY_AFTER, ReadingRoomService, _aware

    start = datetime.combine(d, time(0, 0), tzinfo=ROUND_TZ)
    end = min(_midnight(d), now or datetime.now(tz=ROUND_TZ))
    out: dict[uuid.UUID, int] = {}
    for s in db.execute(
        select(ReadingRoomSession).where(
            ReadingRoomSession.user_id.in_(user_ids),
            ReadingRoomSession.created_at < end.astimezone(timezone.utc),
            # no sitting lasts more than 12 hours (reading_room.MAX_SITTING)
            ReadingRoomSession.created_at > (start - timedelta(days=1)).astimezone(timezone.utc),
        )
    ).scalars():
        began, ended = _aware(s.created_at), _aware(s.ended_at)
        if ended is not None and ended < start:
            continue
        if ended is not None and not s.credited_minutes and s.credited_date is not None:
            continue  # taken back by the reader
        if ended is not None and ended < _midnight(d) and s.credited_round_id is not None and s.credited_date == d:
            continue  # already in that day's circle log, written before midnight
        if ended is None:
            at, seen = end, _aware(s.last_seen_at)
            if s.status == "reading" and at - seen > AWAY_AFTER:
                at = seen
            seconds = ReadingRoomService.elapsed_seconds(s, at)
            if began < start:
                seconds -= ReadingRoomService.elapsed_seconds(s, start)  # what it read the day before
        else:
            at, seconds = min(ended, end), int(s.accumulated_seconds)
        # only the part of the sitting inside the day
        span = (at - max(began, start)).total_seconds()
        minutes = int(max(0, min(seconds, span))) // 60
        if minutes:
            out[s.user_id] = out.get(s.user_id, 0) + minutes
    return out


def _reads(db: Session, user_ids: list[uuid.UUID], war: ClanWar, today: date | None = None) -> set[tuple[uuid.UUID, date]]:
    """Days of 30+ minutes logged before their own midnight (30+ minutes, not the circle's stored score: the war may
    run into the circle's last day, which the circle keeps for corrections and never scores); locked days the room
    counted at midnight; and today, the room's minutes so far on top of what is logged."""
    if not user_ids:
        return set()
    logged = _logged(db, user_ids, war)
    out = {k for k, m in logged.items() if m >= 30}
    out |= {
        (u, d)
        for u, d in db.execute(
            select(ClanWarRoomRead.user_id, ClanWarRoomRead.date).where(
                ClanWarRoomRead.war_id == war.id,
                ClanWarRoomRead.user_id.in_(user_ids),
                ClanWarRoomRead.revoked_at.is_(None),
            )
        ).all()
    }
    today = today or _today()
    if war.start_date <= today <= war.end_date:
        for u, m in _room(db, user_ids, today).items():
            if logged.get((u, today), 0) + m >= 30:
                out.add((u, today))
    return out


def _count_room(db: Session, war: ClanWar, d: date, user_ids: list[uuid.UUID]) -> None:
    """At the day's lock: a member still reading in the room at 00:00 (or just up, nothing saved for the war) whose
    room minutes before midnight, with what they had logged, make 30+ gets the day (founder 2026-10-22)."""
    logged = _logged(db, user_ids, war)
    have = set(
        db.execute(
            select(ClanWarRoomRead.user_id).where(ClanWarRoomRead.war_id == war.id, ClanWarRoomRead.date == d)
        ).scalars()
    )
    for u, m in _room(db, user_ids, d).items():
        before = logged.get((u, d), 0)
        if u not in have and before < 30 <= before + m:
            db.add(ClanWarRoomRead(war_id=war.id, user_id=u, date=d, minutes=min(m, 1440)))
    db.flush()


def _change_day(db: Session, war: ClanWar, user_id: uuid.UUID, d: date, delta: int) -> None:
    """A locked day gains or loses one member's point (the room's word came after midnight)."""
    m = db.execute(
        select(ClanWarMember).where(ClanWarMember.war_id == war.id, ClanWarMember.user_id == user_id)
    ).scalar_one_or_none()
    if m is None or m.team is None:
        return
    row = db.execute(
        select(ClanWarDay).where(ClanWarDay.war_id == war.id, ClanWarDay.date == d, ClanWarDay.team == m.team)
    ).scalar_one_or_none()
    if row is not None:
        row.hits = max(0, min(row.size, row.hits + delta))


def _locked_days_of(db: Session, war: ClanWar, s) -> list[date]:
    """The locked war days a sitting reaches into (a sitting is at most 12 hours: one or two days)."""
    from app.services.reading_room import _aware

    began = _aware(s.created_at).astimezone(ROUND_TZ).date()
    last = (_aware(s.ended_at) or datetime.now(tz=ROUND_TZ)).astimezone(ROUND_TZ).date()
    days = [d for d in (began, last) if war.start_date <= d <= war.end_date]
    locked = set(
        db.execute(select(ClanWarDay.date).where(ClanWarDay.war_id == war.id, ClanWarDay.date.in_(days))).scalars()
    )
    return sorted({d for d in days if d in locked})


def room_changed(db: Session, s) -> None:
    """The reader's word about a sitting after its war day locked: «Отменить» in the room (they were not reading —
    the day the room counted is taken back) or «да, читал» about a silence (the day may now be theirs). Called by the
    room before its own commit; never raises."""
    try:
        war = current_war(db)
        if war is None or war.status != "live":
            return
        ids = [s.user_id]
        for d in _locked_days_of(db, war, s):
            row = db.execute(
                select(ClanWarRoomRead).where(
                    ClanWarRoomRead.war_id == war.id, ClanWarRoomRead.user_id == s.user_id, ClanWarRoomRead.date == d
                )
            ).scalar_one_or_none()
            logged = _logged(db, ids, war).get((s.user_id, d), 0)
            room = _room(db, ids, d).get(s.user_id, 0)
            ok = logged < 30 <= logged + room
            if row is not None and row.revoked_at is None and not ok:
                row.revoked_at = datetime.now(tz=timezone.utc)
                _change_day(db, war, s.user_id, d, -1)
            elif row is None and ok:
                db.add(ClanWarRoomRead(war_id=war.id, user_id=s.user_id, date=d, minutes=min(room, 1440)))
                _change_day(db, war, s.user_id, d, +1)
        db.flush()
    except Exception:  # the room's own save never fails over the war
        import logging

        logging.getLogger(__name__).exception("clan war room_changed")


def not_read(db: Session, user: User) -> dict:
    """«Я не читал(а)» on the war page: the day the room counted at midnight is taken back (the circle's minutes are
    the reader's to fix on the dial)."""
    war = _war_or_404(db)
    rows = db.execute(
        select(ClanWarRoomRead).where(
            ClanWarRoomRead.war_id == war.id, ClanWarRoomRead.user_id == user.id, ClanWarRoomRead.revoked_at.is_(None),
            ClanWarRoomRead.date >= _today() - timedelta(days=1),
        )
    ).scalars().all()
    for row in rows:
        row.revoked_at = datetime.now(tz=timezone.utc)
        _change_day(db, war, user.id, row.date, -1)
    db.commit()
    return state(db, user)


def in_circle(db: Session, user_id: uuid.UUID, war: ClanWar) -> bool:
    """Whether the reader is in the circle the war runs in (they log on its dial)."""
    from app.repositories.claims import ClaimsRepository

    ids = ClaimsRepository(db).effective_user_ids(user_id=user_id)
    return db.execute(
        select(RoundParticipant.id)
        .join(Round, Round.id == RoundParticipant.round_id)
        .where(Round.year == war.start_date.year, Round.month == war.start_date.month, RoundParticipant.user_id.in_(ids))
        .limit(1)
    ).first() is not None


NIGHT_ASK_UNTIL = time(4, 0)  # after 00:00 and before this, the war page asks which day the minutes are for


def _night(now: datetime | None = None) -> bool:
    return (now or _now()).time() < NIGHT_ASK_UNTIL


def _circle_round(db: Session, user_id: uuid.UUID, war: ClanWar) -> Round | None:
    """The circle the reader logs in this month (their own participant row, as the dial uses)."""
    return db.execute(
        select(Round)
        .join(RoundParticipant, RoundParticipant.round_id == Round.id)
        .where(Round.year == war.start_date.year, Round.month == war.start_date.month, RoundParticipant.user_id == user_id)
        .limit(1)
    ).scalar_one_or_none()


def log_read(db: Session, user: User, minutes: int, day: str = "today") -> dict:
    """A day's minutes from the war page (replaces the day's figure). A circle reader's minutes go into the
    circle's own log — the very row the dial writes, its comment and books kept — so the two never differ.
    A guest's go to the war's table. Between 00:00 and 04:00 a circle reader may choose yesterday: it counts
    for the circle only, the war's day having closed at midnight."""
    war = _war_or_404(db)
    today = _today()
    member = db.execute(
        select(ClanWarMember).where(ClanWarMember.war_id == war.id, ClanWarMember.user_id == user.id)
    ).scalar_one_or_none()
    if member is None or member.team is None or war.status != "live" or not (war.start_date <= today <= war.end_date):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Not in a running war")
    minutes = max(0, min(1440, int(minutes)))
    rnd = _circle_round(db, user.id, war)
    if day == "yesterday":
        if rnd is None or not _night():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only today can be logged now")
        d = today - timedelta(days=1)
    else:
        d = today
    if rnd is not None:
        from app.services.reading import ReadingService

        svc = ReadingService(db)
        before = svc.logs.get_for_user_date(round_id=rnd.id, user_id=user.id, day=d)
        svc.log_minutes(
            round_id=rnd.id, user_id=user.id, day=d, minutes=minutes,
            book_finished=bool(before and before.book_finished),
            comment=before.comment if before else None,
            comment_private=bool(before and before.is_comment_private),
        )
        return state(db, user)
    row = db.execute(
        select(ClanWarRead).where(ClanWarRead.war_id == war.id, ClanWarRead.user_id == user.id, ClanWarRead.date == d)
    ).scalar_one_or_none()
    if row is None:
        db.add(ClanWarRead(war_id=war.id, user_id=user.id, date=d, minutes=minutes))
    else:
        row.minutes = minutes
    db.commit()
    return state(db, user)


def _team_rows(members):
    by_team: list[list] = [[], []]
    for row in members:
        if row[0].team in (0, 1):
            by_team[row[0].team].append(row)
    return by_team


def _count(team, war: ClanWar, d: date, reads) -> tuple[int, int]:
    active = [m for m, _, _ in team if _joined_day(m, war) <= d]
    return sum(1 for m in active if (m.user_id, d) in reads), len(active)


def lock_days(db: Session, war: ClanWar | None = None, today: date | None = None) -> int:
    """Lock every finished war day not locked yet (run each minute; safe to repeat)."""
    war = war or current_war(db)
    if war is None or war.status != "live":
        return 0
    today = today or _today()
    done = {(d, t) for d, t in db.execute(
        select(ClanWarDay.date, ClanWarDay.team).where(ClanWarDay.war_id == war.id)
    ).all()}
    days = [d for d in _days(war, today - timedelta(days=1)) if any((d, t) not in done for t in (0, 1))]
    if not days:
        return 0
    members = _members(db, war)
    by_team = _team_rows(members)
    ids = [m.user_id for m, _, _ in members if m.team in (0, 1)]
    for d in days:
        _count_room(db, war, d, ids)
    reads = _reads(db, [m.user_id for m, _, _ in members], war, today)
    n = 0
    for d in days:
        for t in (0, 1):
            if (d, t) in done:
                continue
            hits, size = _count(by_team[t], war, d, reads)
            db.add(ClanWarDay(war_id=war.id, date=d, team=t, hits=hits, size=size))
            n += 1
    try:
        db.commit()
    except Exception:  # the other worker locked it first
        db.rollback()
        return 0
    return n


def scheduled() -> None:
    from app.db.session import get_session_factory

    db = get_session_factory()()
    try:
        war = current_war(db)
        if war is not None and war.status == "signup" and _now() >= signup_deadline(war):
            try:
                split(db, None)
            except HTTPException:
                db.rollback()  # the other worker split it
        lock_days(db)
        from app.services import clan_war_chat

        try:
            clan_war_chat.bot_tick(db)
        except Exception:  # the bot's words never stop the war's own tick
            db.rollback()
    finally:
        db.close()


def state(db: Session, viewer: User | None, *, unmasked: bool = False) -> dict:
    """`unmasked` is for the server's own use (a team's bot reading that team's count), never for a page."""
    war = _war_or_404(db)
    today = _today()
    total_days = (war.end_date - war.start_date).days + 1
    if war.status == "live":
        lock_days(db, war, today)
    members = _members(db, war)
    phase = war.status
    if phase == "live" and today > war.end_date:
        phase = "done"
    me = next((m for m, u, _ in members if viewer and m.user_id == viewer.id), None)
    from app.services.leagues import leagues_by_user

    tiers = leagues_by_user(db)
    person = lambda u, a: {"user_id": str(u.id), "display_name": u.display_name, "avatar": str(a) if a else None, "league": tiers.get(u.id)}  # noqa: E731

    out: dict = {
        "id": str(war.id),
        "start_date": war.start_date.isoformat(),
        "end_date": war.end_date.isoformat(),
        "status": phase,
        "prize": war.prize,
        "days_total": total_days,
        "day": max(0, min(total_days, (today - war.start_date).days + 1)),
        "joined_count": len(members),
        "signup_until": signup_deadline(war).isoformat(),
        "starts_at": datetime.combine(war.start_date, time(0, 0), tzinfo=ROUND_TZ).isoformat(),
        "is_admin": bool(viewer and viewer.system_role in {SystemRole.admin, SystemRole.superadmin}),
        "me": {
            "joined": me is not None,
            "team": TEAMS[me.team] if me is not None and me.team is not None else None,
            "guest": bool(viewer) and not in_circle(db, viewer.id, war),
        },
        "joined": [person(u, a) for m, u, a in members] if war.status == "signup" else [],
        "teams": [],
        "winner": None,
    }
    if war.status == "signup":
        return out

    by_team = _team_rows(members)
    locked = {
        (d, t): (h, sz)
        for d, t, h, sz in db.execute(
            select(ClanWarDay.date, ClanWarDay.team, ClanWarDay.hits, ClanWarDay.size).where(ClanWarDay.war_id == war.id)
        ).all()
    }
    reads = _reads(db, [m.user_id for m, _, _ in members], war)
    all_days = [war.start_date + timedelta(days=i) for i in range(total_days)]
    live_today = war.start_date <= today <= war.end_date

    lines: list[list[dict]] = [[], []]
    strikes = [0, 0]
    sizes_by_day: list[list[int]] = [[], []]
    for t in (0, 1):
        current = len(by_team[t])
        for d in all_days:
            if (d, t) in locked:
                h, sz = locked[(d, t)]
                lines[t].append({"date": d.isoformat(), "hits": h, "size": sz, "locked": True})
                strikes[t] += h
                sizes_by_day[t].append(sz)
            elif d == today and live_today:
                h, sz = _count(by_team[t], war, d, reads)
                # the rival's day stays hidden until its midnight (founder 2026-10-18): a reader sees only their own team's
                # running count; a visitor without a team sees neither
                shown = unmasked or (me is not None and me.team == t)
                lines[t].append({"date": d.isoformat(), "hits": h if shown else None, "size": sz, "locked": False})
                sizes_by_day[t].append(current)
            else:
                sizes_by_day[t].append(current)

    for t in (0, 1):
        other = 1 - t
        bricks = sum(sizes_by_day[other])  # what the other team could strike in all the days
        left = max(0, bricks - strikes[other])
        shelf = sum(sizes_by_day[t])  # the team's own library: a place for every member's every day
        out["teams"].append(
            {
                "key": TEAMS[t],
                "size": len(by_team[t]),
                "bricks": bricks,
                "bricks_left": left,
                "hp": round(100.0 * left / bricks, 1) if bricks else 100.0,
                "points": strikes[t],
                "shelf": shelf,
                "fill": round(100.0 * strikes[t] / shelf, 1) if shelf else 0.0,
                "today": next((x["hits"] for x in lines[t] if not x["locked"]), None),  # None for the rival's hidden day
                "members": [person(u, a) for _, u, a in by_team[t]],
                "days": lines[t],
            }
        )
    # the day that has just closed: the page plays its midnight reveal (books flying onto the two shelves) once per reader
    if war.status == "live" and war.start_date < today <= war.end_date + timedelta(days=1):
        last = min(today - timedelta(days=1), war.end_date)
        got = [next((x for x in lines[t] if x["date"] == last.isoformat() and x["locked"]), None) for t in (0, 1)]
        if all(got):
            out["reveal"] = {
                "date": last.isoformat(),
                "n": (last - war.start_date).days + 1,
                "hits": [g["hits"] for g in got],
                "sizes": [g["size"] for g in got],
                "final": last == war.end_date,
            }
    if me is not None and me.team is not None:
        mine = [d for d in all_days if d <= today and (me.user_id, d) in reads and d >= _joined_day(me, war)]
        out["me"]["hits"] = len(mine)
        out["me"]["days"] = len([d for d in all_days if _joined_day(me, war) <= d <= min(today, war.end_date)])
        out["me"]["today"] = (me.user_id, today) in reads
        # who of your own team has put today's book on the shelf (council 2026-10-17: show only what someone did,
        # never who hasn't; roster order, not arrival order, so nobody is «last»; your own team only)
        out["me"]["shelf_today"] = (
            [person(u, a) for m, u, a in by_team[me.team] if (m.user_id, today) in reads] if live_today else []
        )
        # today's minutes, wherever they were logged: «ещё 12 мин — и книга» on the war page and the circle's card
        if out["me"]["guest"]:
            row = db.execute(
                select(ClanWarRead.minutes).where(
                    ClanWarRead.war_id == war.id, ClanWarRead.user_id == me.user_id, ClanWarRead.date == today
                )
            ).scalar_one_or_none()
        else:
            row = db.execute(
                select(func.max(ReadingLog.minutes)).where(ReadingLog.user_id == me.user_id, ReadingLog.date == today)
            ).scalar_one_or_none()
            # in the small hours a circle reader is asked which day: yesterday's figure for the form
            if live_today and _night():
                out["me"]["ask_day"] = True
                out["me"]["minutes_yesterday"] = int(
                    db.execute(
                        select(func.max(ReadingLog.minutes)).where(
                            ReadingLog.user_id == me.user_id, ReadingLog.date == today - timedelta(days=1)
                        )
                    ).scalar_one_or_none()
                    or 0
                )
        out["me"]["minutes"] = int(row or 0)
        # «засчитано из читального зала»: last night's chair counted at 00:00, with «Я не читал(а)» beside it
        room = db.execute(
            select(ClanWarRoomRead.date, ClanWarRoomRead.minutes).where(
                ClanWarRoomRead.war_id == war.id, ClanWarRoomRead.user_id == me.user_id,
                ClanWarRoomRead.revoked_at.is_(None), ClanWarRoomRead.date == today - timedelta(days=1),
            )
        ).first()
        out["me"]["room_read"] = {"date": room[0].isoformat(), "minutes": int(room[1])} if room else None
    if phase == "done":
        # the fullest library wins (books against the places on its shelves)
        fill = [x["fill"] for x in out["teams"]]
        out["winner"] = TEAMS[0] if fill[0] > fill[1] else TEAMS[1] if fill[1] > fill[0] else "draw"
    return out


def join(db: Session, user: User) -> dict:
    war = _war_or_404(db)
    if war.status != "signup" or _now() >= signup_deadline(war):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Sign-up is closed")
    exists = db.execute(
        select(ClanWarMember).where(ClanWarMember.war_id == war.id, ClanWarMember.user_id == user.id)
    ).scalar_one_or_none()
    if exists is None:
        db.add(ClanWarMember(war_id=war.id, user_id=user.id, team=None))
        db.commit()
    return state(db, user)


def leave(db: Session, user: User) -> dict:
    war = _war_or_404(db)
    if war.status != "signup":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Teams are already split")
    row = db.execute(
        select(ClanWarMember).where(ClanWarMember.war_id == war.id, ClanWarMember.user_id == user.id)
    ).scalar_one_or_none()
    if row is not None:
        db.delete(row)
        db.commit()
    return state(db, user)


def split(db: Session, admin: User | None) -> dict:
    """Two even teams: the strongest readers (league, then last circle's days) dealt in turn, A B B A A B …
    Done by the scheduler at 20:00 on the eve of the start, or by the founder's button before that."""
    from sqlalchemy import update

    from app.services.leagues import compute_all

    war = _war_or_404(db)
    # one worker only: whoever flips signup → live first does the dealing
    claimed = db.execute(
        update(ClanWar).where(ClanWar.id == war.id, ClanWar.status == "signup").values(status="live")
    ).rowcount
    if not claimed:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Teams are already split")
    db.refresh(war)
    members = [m for m, _, _ in _members(db, war)]
    leagues = compute_all(db)

    def strength(m: ClanWarMember) -> tuple:
        st = leagues.get(m.user_id)
        return (st.level, st.last_scored) if st else (0, 0)

    ranked = sorted(members, key=strength, reverse=True)
    for i, m in enumerate(ranked):
        m.team = 0 if i % 4 in (0, 3) else 1
    war.status = "live"
    war.split_at = datetime.now(tz=ROUND_TZ)
    db.commit()
    return state(db, admin)


def set_prize(db: Session, text: str | None) -> dict:
    war = _war_or_404(db)
    war.prize = (text or "").strip() or None
    db.commit()
    return {"prize": war.prize}
