"""«Чат команды» of «Битва кланов»: one room per team, seen and written only by its members.

- Reading needs nothing; writing asks once for the same consent as the buddy chat (16+, how
  messages are kept: app/services/buddy_chat.py), kept with its date.
- Text only, up to 500 characters, one message per two seconds.
- The bot speaks only in team numbers, never names (council 2026-10-17): the start, 21:00
  («x of y on the shelf, three hours left» while the shelf is not full) and the day's close at
  00:00. Its lines are codes with numbers, worded on the reader's side in their language.
- A message can be reported; the founder hears in Telegram without the message's text (it
  never leaves our server) and deletes it in the chat. The author can delete their own.
- After the war the room stays, read-only.
"""
from __future__ import annotations

import uuid
from datetime import datetime, time, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.clan_war import ClanWar, ClanWarDay, ClanWarMember, ClanWarMessage, ClanWarReport
from app.models.enums import SystemRole
from app.models.user import User
from app.services import buddy_chat, clan_war

MAX_LEN = 500
LIMIT = 200
EVENING = time(21, 0)
GAP = timedelta(seconds=2)


def _is_admin(user: User) -> bool:
    return user.system_role in {SystemRole.admin, SystemRole.superadmin}


def _seat(db: Session, user: User) -> tuple[ClanWar, ClanWarMember]:
    war = clan_war._war_or_404(db)
    member = db.execute(
        select(ClanWarMember).where(ClanWarMember.war_id == war.id, ClanWarMember.user_id == user.id)
    ).scalar_one_or_none()
    if member is None or member.team is None or war.status == "signup":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Team members only")
    return war, member


def _open(war: ClanWar) -> bool:
    return war.status == "live" and clan_war._today() <= war.end_date


def room(db: Session, user: User) -> dict:
    war, me = _seat(db, user)
    from app.services.leagues import leagues_by_user

    tiers = leagues_by_user(db)
    rows = db.execute(
        select(ClanWarMessage, User, func.length(User.avatar_data))
        .outerjoin(User, User.id == ClanWarMessage.user_id)
        .where(ClanWarMessage.war_id == war.id, ClanWarMessage.team == me.team, ClanWarMessage.deleted_at.is_(None))
        .order_by(ClanWarMessage.created_at.desc())
        .limit(LIMIT)
    ).all()
    size = db.execute(
        select(func.count()).select_from(ClanWarMember).where(ClanWarMember.war_id == war.id, ClanWarMember.team == me.team)
    ).scalar_one()

    def at(m: ClanWarMessage) -> str:
        c = m.created_at
        return (c if c.tzinfo else c.replace(tzinfo=timezone.utc)).isoformat()

    return {
        "team": clan_war.TEAMS[me.team],
        "size": int(size),
        "consented": buddy_chat.consented(db, user.id),
        "open": _open(war),
        "can_delete_any": _is_admin(user),
        "messages": [
            {
                "id": str(m.id),
                "kind": m.kind,
                "user_id": str(u.id) if u else None,
                "display_name": u.display_name if u else None,
                "avatar": str(a) if a else None,
                "league": tiers.get(u.id) if u else None,
                "text": m.text or "",
                "code": m.code,
                "params": m.params or {},
                "at": at(m),
                "mine": bool(u and u.id == user.id),
            }
            for m, u, a in reversed(rows)
        ],
    }


def consent(db: Session, user: User, *, age_16: bool, agree: bool) -> dict:
    _seat(db, user)
    buddy_chat.give_consent(db, user, age_16=age_16, agree=agree)
    return room(db, user)


def post(db: Session, user: User, text: str) -> dict:
    war, me = _seat(db, user)
    if not _open(war):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The war is over")
    if not buddy_chat.consented(db, user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="consent_required")
    body = (text or "").strip()
    if not body:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Empty message")
    body = body[:MAX_LEN]
    last = db.execute(
        select(func.max(ClanWarMessage.created_at)).where(ClanWarMessage.war_id == war.id, ClanWarMessage.user_id == user.id)
    ).scalar_one_or_none()
    if last is not None:
        last = last if last.tzinfo else last.replace(tzinfo=timezone.utc)
        if datetime.now(tz=timezone.utc) - last < GAP:
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too fast")
    db.add(ClanWarMessage(war_id=war.id, team=me.team, user_id=user.id, kind="user", text=body,
                          created_at=datetime.now(tz=timezone.utc)))
    db.commit()
    return room(db, user)


def _message(db: Session, war: ClanWar, me: ClanWarMember, message_id: uuid.UUID) -> ClanWarMessage:
    m = db.get(ClanWarMessage, message_id)
    if m is None or m.war_id != war.id or m.team != me.team or m.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    return m


def delete(db: Session, user: User, message_id: uuid.UUID) -> dict:
    war, me = _seat(db, user)
    m = _message(db, war, me, message_id)
    if m.user_id != user.id and not _is_admin(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not yours")
    m.deleted_at = datetime.now(tz=timezone.utc)
    db.commit()
    return room(db, user)


def report(db: Session, user: User, message_id: uuid.UUID, reason: str | None) -> dict:
    war, me = _seat(db, user)
    m = _message(db, war, me, message_id)
    db.add(ClanWarReport(message_id=m.id, reporter_id=user.id, reason=(reason or "").strip()[:1000] or None))
    db.commit()
    author = db.get(User, m.user_id) if m.user_id else None
    from app.services import admin_ping

    when = (m.created_at if m.created_at.tzinfo else m.created_at.replace(tzinfo=timezone.utc)).astimezone(clan_war.ROUND_TZ)
    team = "Маяк" if me.team == 0 else "Парус"
    admin_ping.tell_admins(
        f"⚠️ Жалоба в чате «{team}»: сообщение {author.display_name if author else '—'} от {when:%d.%m %H:%M}. "
        f"Открой powerbook.kz/war → «⋯» у сообщения, чтобы удалить. Ответить нужно в течение 20 дней."
    )
    return {"ok": True}


# ---------- the bot ----------


def _say(db: Session, war: ClanWar, team: int, key: str, code: str, params: dict, at: datetime | None = None) -> bool:
    """One bot line per (team, key), whichever worker gets there first."""
    exists = db.execute(
        select(ClanWarMessage.id).where(ClanWarMessage.war_id == war.id, ClanWarMessage.team == team, ClanWarMessage.key == key)
    ).first()
    if exists:
        return False
    db.add(ClanWarMessage(war_id=war.id, team=team, kind="bot", code=code, params=params, key=key,
                          created_at=at or datetime.now(tz=timezone.utc)))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return False
    return True


def bot_tick(db: Session, war: ClanWar | None = None, now: datetime | None = None) -> None:
    """Run each minute after the war's own tick: the start, the evening count, the day's close."""
    war = war or clan_war.current_war(db)
    if war is None or war.status != "live":
        return
    now = now or clan_war._now()
    today = now.date()
    total = (war.end_date - war.start_date).days + 1
    start_at = datetime.combine(war.start_date, time(0, 0), tzinfo=clan_war.ROUND_TZ)
    if war.start_date <= today <= war.end_date:
        for t in (0, 1):
            _say(db, war, t, "start", "start", {"total": total}, at=start_at)
    # each locked day, once: this team's books and the other's, and the next day's number
    days = db.execute(
        select(ClanWarDay.date, ClanWarDay.team, ClanWarDay.hits, ClanWarDay.size).where(ClanWarDay.war_id == war.id)
    ).all()
    by = {(d, t): (h, s) for d, t, h, s in days}
    for (d, t), (h, s) in by.items():
        other = by.get((d, 1 - t), (0, 0))
        n = (d - war.start_date).days + 1
        close_at = datetime.combine(d + timedelta(days=1), time(0, 0), tzinfo=clan_war.ROUND_TZ)
        _say(db, war, t, f"day:{d.isoformat()}", "day",
             {"n": n, "total": total, "hits": h, "size": s, "ohits": other[0], "osize": other[1], "last": n >= total},
             at=close_at)
    # 21:00: the count so far, only while the shelf is not full
    if war.start_date <= today <= war.end_date and now.time() >= EVENING:
        state = clan_war.state(db, None)
        for t in (0, 1):
            team = state["teams"][t]
            line = next((x for x in team["days"] if x["date"] == today.isoformat()), None)
            if line and line["size"] and line["hits"] < line["size"]:
                _say(db, war, t, f"eve:{today.isoformat()}", "evening", {"hits": line["hits"], "size": line["size"]},
                     at=datetime.combine(today, EVENING, tzinfo=clan_war.ROUND_TZ))
