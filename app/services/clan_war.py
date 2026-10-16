"""«Битва кланов»: two teams, 14 days, the circle's own days of reading.

- Attack: every day a member reads 30+ minutes (the circle's scored day)
  strikes the other team's fortress. A day's strike is the share of the team
  that read, so a team of 12 and a team of 10 hit equally hard.
- Shield: a day when 80% of a team read, the other team's strikes that day
  do half the damage.
- Each fortress starts at 100; one full day of the whole team reading takes
  100/14 off the other. After the last day the stronger fortress wins.

Members count from the day they joined, so a late joiner does not pull the
team's past days down. Only team numbers are public; a member sees their own.
Nothing here touches the circle's table, points or winners.
"""
from __future__ import annotations

import math
import uuid
from datetime import date, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.constants import ROUND_TZ
from app.models.clan_war import ClanWar, ClanWarMember
from app.models.enums import SystemRole
from app.models.round import ReadingLog
from app.models.user import User

TEAMS = ["lighthouse", "sail"]
SHIELD_SHARE = 0.8
SHIELD_FACTOR = 0.5


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


def state(db: Session, viewer: User | None) -> dict:
    war = _war_or_404(db)
    today = _today()
    total_days = (war.end_date - war.start_date).days + 1
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

    days = _days(war, today)
    reads = _reads(db, [m.user_id for m, _, _ in members], war)
    by_team: list[list[tuple[ClanWarMember, User, int | None]]] = [[], []]
    for row in members:
        if row[0].team in (0, 1):
            by_team[row[0].team].append(row)

    daily = []  # per team: list of (hits, size, shield)
    for team in by_team:
        line = []
        for d in days:
            active = [m for m, _, _ in team if _joined_day(m, war) <= d]
            hits = sum(1 for m in active if (m.user_id, d) in reads)
            size = len(active)
            shield = size > 0 and hits >= math.ceil(SHIELD_SHARE * size)
            line.append((hits, size, shield))
        daily.append(line)

    per_day = 100.0 / total_days
    hp = [100.0, 100.0]
    for i in range(len(days)):
        for t in (0, 1):
            other = 1 - t
            hits, size, _ = daily[other][i]
            if size:
                dmg = hits / size * per_day * (SHIELD_FACTOR if daily[t][i][2] else 1.0)
                hp[t] -= dmg
    hp = [max(0.0, round(h, 1)) for h in hp]

    for t in (0, 1):
        out["teams"].append(
            {
                "key": TEAMS[t],
                "size": len(by_team[t]),
                "hp": hp[t],
                "members": [person(u, a) for _, u, a in by_team[t]],
                "days": [
                    {"date": d.isoformat(), "hits": h, "size": s, "shield": sh}
                    for d, (h, s, sh) in zip(days, daily[t])
                ],
            }
        )
    if me is not None and me.team is not None:
        mine = [d for d in days if (me.user_id, d) in reads]
        out["me"]["hits"] = len(mine)
        out["me"]["days"] = len([d for d in days if d >= _joined_day(me, war)])
    if phase == "done":
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
