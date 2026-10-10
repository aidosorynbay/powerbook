"""«Приведи друга»: who came by a reader's link, and what they have read since.

The founder (2026-10-10), after the Sadaqa app, where a giver sees how many
signed up by their link and what those people gave: here it is the reading
they did, in days and minutes, never pages. A guest is whoever signed up from
the reader's link (users.invited_by, set at sign-up by day_share's /r/<name>
page or the /join?ref= invitation). Their guests count too, further down the
chain: «через них ещё N».
"""
from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.models.round import ReadingLog
from app.models.user import User
from app.schemas.share import InviteGuestOut, InvitesOut, InviteTotalsOut


def _reading(db: Session, user_ids: list[uuid.UUID]) -> dict[uuid.UUID, tuple[int, int, int, date | None]]:
    """Each reader's minutes, days read, books finished and last day read, over every round."""
    if not user_ids:
        return {}
    rows = db.execute(
        select(
            ReadingLog.user_id,
            func.coalesce(func.sum(ReadingLog.minutes), 0),
            func.count(case((ReadingLog.minutes > 0, 1))),
            func.count(case((ReadingLog.book_finished.is_(True), 1))),
            func.max(case((ReadingLog.minutes > 0, ReadingLog.date))),
        )
        .where(ReadingLog.user_id.in_(user_ids))
        .group_by(ReadingLog.user_id)
    ).all()
    return {uid: (int(m), int(d), int(f), last) for uid, m, d, f, last in rows}


def _totals(people: int, reading: dict, ids) -> InviteTotalsOut:
    got = [reading.get(i, (0, 0, 0, None)) for i in ids]
    return InviteTotalsOut(
        people=people,
        minutes=sum(r[0] for r in got),
        days=sum(r[1] for r in got),
        finished=sum(r[2] for r in got),
    )


def mine(db: Session, *, user: User) -> InvitesOut:
    # Every link of the chain at once: there are few readers, and few of them invited.
    links: dict[uuid.UUID, list[uuid.UUID]] = {}
    for uid, by in db.execute(select(User.id, User.invited_by).where(User.invited_by.is_not(None))).all():
        links.setdefault(by, []).append(uid)

    direct = links.get(user.id, [])
    further: list[uuid.UUID] = []
    seen = {user.id, *direct}
    wave = list(direct)
    while wave:
        nxt = [g for p in wave for g in links.get(p, []) if g not in seen]
        seen.update(nxt)
        further.extend(nxt)
        wave = nxt

    reading = _reading(db, direct + further)
    guests = []
    if direct:
        rows = db.execute(
            select(User.id, User.username, User.display_name, User.avatar_data, User.created_at, User.is_active)
            .where(User.id.in_(direct))
        ).all()
        for uid, username, name, avatar, joined, active in rows:
            minutes, days, finished, last = reading.get(uid, (0, 0, 0, None))
            guests.append(InviteGuestOut(
                user_id=str(uid),
                username=username,
                display_name=name or username,
                avatar_data=avatar if active else None,
                joined=joined.date() if joined else None,
                minutes=minutes,
                days=days,
                finished=finished,
                last_day=last,
                brought=sum(1 for g in links.get(uid, []) if g != user.id),
            ))
        guests.sort(key=lambda g: (-g.minutes, g.joined or date.min))

    return InvitesOut(
        username=user.username,
        guests=guests,
        direct=_totals(len(direct), reading, direct),
        further=_totals(len(further), reading, further),
    )
