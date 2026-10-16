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
from datetime import date, datetime, time, timedelta

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.constants import ROUND_TZ
from app.models.clan_war import ClanWar, ClanWarDay, ClanWarMember, ClanWarRead
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


def _reads(db: Session, user_ids: list[uuid.UUID], war: ClanWar) -> set[tuple[uuid.UUID, date]]:
    """Days of 30+ minutes: from the circle's logs, and from the war page for guests."""
    if not user_ids:
        return set()
    window = (war.start_date, war.end_date)
    rows = db.execute(
        select(ReadingLog.user_id, ReadingLog.date).where(
            ReadingLog.user_id.in_(user_ids),
            # 30+ minutes, not the circle's stored score: the war may run into the
            # circle's last day, which the circle keeps for corrections and never scores
            ReadingLog.minutes >= 30,
            ReadingLog.date >= window[0],
            ReadingLog.date <= window[1],
        )
    ).all()
    guest = db.execute(
        select(ClanWarRead.user_id, ClanWarRead.date).where(
            ClanWarRead.war_id == war.id, ClanWarRead.user_id.in_(user_ids), ClanWarRead.minutes >= 30
        )
    ).all()
    return {(u, d) for u, d in rows} | {(u, d) for u, d in guest}


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


def log_guest(db: Session, user: User, minutes: int) -> dict:
    """A guest's minutes for today, on the war page (replaces today's figure)."""
    war = _war_or_404(db)
    today = _today()
    member = db.execute(
        select(ClanWarMember).where(ClanWarMember.war_id == war.id, ClanWarMember.user_id == user.id)
    ).scalar_one_or_none()
    if member is None or war.status != "live" or not (war.start_date <= today <= war.end_date):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Not in a running war")
    if in_circle(db, user.id, war):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Log on the circle's dial")
    minutes = max(0, min(1440, int(minutes)))
    row = db.execute(
        select(ClanWarRead).where(ClanWarRead.war_id == war.id, ClanWarRead.user_id == user.id, ClanWarRead.date == today)
    ).scalar_one_or_none()
    if row is None:
        db.add(ClanWarRead(war_id=war.id, user_id=user.id, date=today, minutes=minutes))
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
    reads = _reads(db, [m.user_id for m, _, _ in members], war)
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
    finally:
        db.close()


def state(db: Session, viewer: User | None) -> dict:
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
    person = lambda u, a: {"user_id": str(u.id), "display_name": u.display_name, "avatar": str(a) if a else None}  # noqa: E731

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
                lines[t].append({"date": d.isoformat(), "hits": h, "size": sz, "locked": False})
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
                "today": next((x["hits"] for x in lines[t] if not x["locked"]), None),
                "members": [person(u, a) for _, u, a in by_team[t]],
                "days": lines[t],
            }
        )
    if me is not None and me.team is not None:
        mine = [d for d in all_days if d <= today and (me.user_id, d) in reads and d >= _joined_day(me, war)]
        out["me"]["hits"] = len(mine)
        out["me"]["days"] = len([d for d in all_days if _joined_day(me, war) <= d <= min(today, war.end_date)])
        out["me"]["today"] = (me.user_id, today) in reads
        if out["me"]["guest"]:
            row = db.execute(
                select(ClanWarRead.minutes).where(
                    ClanWarRead.war_id == war.id, ClanWarRead.user_id == me.user_id, ClanWarRead.date == today
                )
            ).scalar_one_or_none()
            out["me"]["minutes"] = int(row or 0)
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
