"""«Битва кланов»: two teams, 14 days, the circle's own days of reading.

- A point: every member who has a scored day (30+ minutes, logged on the
  circle's dial) before 00:00 brings their team one point for that day.
- At 00:00 (Astana) the day is locked: each of the team's points is one
  strike, and each strike knocks one brick out of the other team's fortress.
  Logs entered after midnight for a locked day change nothing.
- A fortress holds as many bricks as the other team could strike in 14 days
  (its members × days), so a team of 12 and a team of 10 fight evenly.
  After the last day the fortress with the larger share of bricks standing wins.

Members count from the day they joined. Only team numbers are public; a
member sees their own points. Nothing here touches the circle's table.
"""
from __future__ import annotations

import math
import uuid
from datetime import date, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.constants import ROUND_TZ
from app.models.clan_war import ClanWar, ClanWarDay, ClanWarMember
from app.models.enums import SystemRole
from app.models.round import ReadingLog
from app.models.user import User

TEAMS = ["lighthouse", "sail"]


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
    if not user_ids:
        return set()
    rows = db.execute(
        select(ReadingLog.user_id, ReadingLog.date).where(
            ReadingLog.user_id.in_(user_ids),
            ReadingLog.score == 1,
            ReadingLog.date >= war.start_date,
            ReadingLog.date <= war.end_date,
        )
    ).all()
    return {(u, d) for u, d in rows}


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
        "is_admin": bool(viewer and viewer.system_role in {SystemRole.admin, SystemRole.superadmin}),
        "me": {"joined": me is not None, "team": TEAMS[me.team] if me is not None and me.team is not None else None},
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
        out["teams"].append(
            {
                "key": TEAMS[t],
                "size": len(by_team[t]),
                "bricks": bricks,
                "bricks_left": left,
                "hp": round(100.0 * left / bricks, 1) if bricks else 100.0,
                "points": strikes[t],
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
    if phase == "done":
        hp = [x["hp"] for x in out["teams"]]
        out["winner"] = TEAMS[0] if hp[0] > hp[1] else TEAMS[1] if hp[1] > hp[0] else "draw"
    return out


def join(db: Session, user: User) -> dict:
    war = _war_or_404(db)
    if war.status == "done" or _today() > war.end_date:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The war is over")
    exists = db.execute(
        select(ClanWarMember).where(ClanWarMember.war_id == war.id, ClanWarMember.user_id == user.id)
    ).scalar_one_or_none()
    if exists is None:
        team = None
        if war.status == "live":
            # after the split a newcomer joins the smaller team (the weaker one on a tie)
            sizes = [0, 0]
            for m, _, _ in _members(db, war):
                if m.team in (0, 1):
                    sizes[m.team] += 1
            if sizes[0] != sizes[1]:
                team = 0 if sizes[0] < sizes[1] else 1
            else:
                hp = [t["hp"] for t in state(db, None)["teams"]]
                team = 0 if hp[0] <= hp[1] else 1
        db.add(ClanWarMember(war_id=war.id, user_id=user.id, team=team))
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


def split(db: Session, admin: User) -> dict:
    """Two even teams: the strongest readers (league, then last circle's days) dealt in turn, A B B A A B …"""
    from app.services.leagues import compute_all

    war = _war_or_404(db)
    if war.status != "signup":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Teams are already split")
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
