"""Private messages between readers — «buddy» — on the site instead of Telegram.

The founder asked for it on 2026-10-15, and first for whether it is lawful. The legal check (KZ law
94-V on personal data, the 2023 law on online platforms) and the council shaped it:

- the messages stay on our server in Kazakhstan (Hoster.KZ, Astana), and their words never travel
  to another service: a push says only who wrote, the founder's Telegram hears only that a complaint
  came;
- nobody writes, or reads a conversation, before saying yes once: 16 or older, and the consent words
  of CONSENT_VERSION, kept with the moment (the law wants consent that can be shown);
- buddy is a one-way follow, so a first message to someone who did not add you back is a request:
  they see who wants to talk, not the words, until they «Принять» (or add you back, or answer);
- «Заблокировать» stops both sides and «Пожаловаться» sends the team the latest messages of that
  conversation (the only way the team sees one, answered within 20 days); both work without the
  consent, so nobody has to agree to anything to protect themselves;
- everything goes with the account, except complaints about it (app/services/account_deletion.py).
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.core.constants import ROUND_TZ
from app.models.buddy import ReadingBuddy
from app.models.chat import BuddyMessage, ChatAccept, ChatBlock, ChatConsent, ChatReport
from app.models.push import ReadingReminder
from app.models.user import User
from app.services import notify

logger = logging.getLogger(__name__)

KIND = "buddy_message"
CONSENT_VERSION = "2026-10-15"
MAX_CHARS = 2000
DAILY_MESSAGES = 60
DAILY_NEW_CONVERSATIONS = 10
# Messages that may wait in a request nobody has accepted yet.
PENDING_MAX = 3
REPORT_EXCERPT = 20
SITE = "https://powerbook.kz"
PUSH_WORDS = {
    "message": {"ru": "Новое сообщение", "kk": "Жаңа хабарлама", "en": "New message"},
    "request": {"ru": "Хочет переписываться", "kk": "Хат алмасқысы келеді", "en": "Wants to chat"},
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _name(user: User | None) -> str:
    return (user.display_name or user.username) if user else "—"


def _pair(a: uuid.UUID, b: uuid.UUID):
    return or_(
        and_(BuddyMessage.sender_id == a, BuddyMessage.recipient_id == b),
        and_(BuddyMessage.sender_id == b, BuddyMessage.recipient_id == a),
    )


# ---------- consent ----------


def consented(db: Session, user_id: uuid.UUID) -> bool:
    row = db.get(ChatConsent, user_id)
    return row is not None and row.version == CONSENT_VERSION


def give_consent(db: Session, user: User, *, age_16: bool, agree: bool) -> dict:
    if not (age_16 and agree):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="consent_required")
    row = db.get(ChatConsent, user.id)
    if row is None:
        row = ChatConsent(user_id=user.id, version=CONSENT_VERSION, accepted_at=_now())
        db.add(row)
    else:
        row.version = CONSENT_VERSION
        row.accepted_at = _now()
    db.commit()
    return {"consented": True}


def _need_consent(db: Session, user: User) -> None:
    if not consented(db, user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="consent_required")


# ---------- who hears whom ----------


def _other(db: Session, other_id: uuid.UUID) -> User:
    other = db.get(User, other_id)
    if other is None or not other.is_active or other.is_claimable:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="reader_not_found")
    return other


def _blocked(db: Session, a: uuid.UUID, b: uuid.UUID) -> tuple[bool, bool]:
    """(a blocked b, b blocked a)."""
    rows = set(db.execute(
        select(ChatBlock.blocker_id).where(
            or_(and_(ChatBlock.blocker_id == a, ChatBlock.blocked_id == b), and_(ChatBlock.blocker_id == b, ChatBlock.blocked_id == a))
        )
    ).scalars())
    return a in rows, b in rows


def _follows(db: Session, a: uuid.UUID, b: uuid.UUID) -> bool:
    return db.execute(
        select(ReadingBuddy.id).where(ReadingBuddy.user_id == a, ReadingBuddy.buddy_user_id == b)
    ).first() is not None


def _wrote(db: Session, a: uuid.UUID, b: uuid.UUID) -> bool:
    return db.execute(
        select(BuddyMessage.id).where(BuddyMessage.sender_id == a, BuddyMessage.recipient_id == b).limit(1)
    ).first() is not None


def hears(db: Session, user_id: uuid.UUID, other_id: uuid.UUID) -> bool:
    """Whether `user_id` wants to hear from `other_id`: added them, accepted them, or wrote to them."""
    return (
        _follows(db, user_id, other_id)
        or db.get(ChatAccept, (user_id, other_id)) is not None
        or _wrote(db, user_id, other_id)
    )


def _may_write(db: Session, me: User, other: User) -> str | None:
    """Why not, or None."""
    if other.id == me.id:
        return "self"
    i_blocked, they_blocked = _blocked(db, me.id, other.id)
    if i_blocked:
        return "you_blocked"
    if they_blocked:
        return "blocked"
    if hears(db, other.id, me.id):
        return None
    if not _follows(db, me.id, other.id):
        return "not_buddy"
    waiting = db.execute(
        select(func.count()).where(BuddyMessage.sender_id == me.id, BuddyMessage.recipient_id == other.id)
    ).scalar_one()
    return "waiting" if waiting >= PENDING_MAX else None


# ---------- reading ----------


def _message_out(m: BuddyMessage, me: uuid.UUID) -> dict:
    return {"id": str(m.id), "text": m.text, "created_at": m.created_at, "mine": m.sender_id == me}


def _person(user: User) -> dict:
    return {"user_id": str(user.id), "name": _name(user), "username": user.username, "avatar_data": user.avatar_data}


def conversations(db: Session, user: User) -> list[dict]:
    """Everyone this reader has talked to, the latest first. The words show only after the reader's yes,
    and a request only after they accepted it; before that, who wrote and how many."""
    agreed = consented(db, user.id)
    rows = db.execute(
        select(BuddyMessage).where(or_(BuddyMessage.sender_id == user.id, BuddyMessage.recipient_id == user.id))
        .order_by(BuddyMessage.created_at.desc())
    ).scalars().all()
    seen: dict[uuid.UUID, dict] = {}
    for m in rows:
        other_id = m.recipient_id if m.sender_id == user.id else m.sender_id
        entry = seen.get(other_id)
        if entry is None:
            other = db.get(User, other_id)
            if other is None:
                continue
            request = not hears(db, user.id, other_id)
            entry = seen[other_id] = {
                **_person(other), "last_text": m.text[:140] if agreed and not request else "", "last_at": m.created_at,
                "last_mine": m.sender_id == user.id, "unread": 0, "request": request,
            }
        if m.recipient_id == user.id and m.read_at is None:
            entry["unread"] += 1
    return list(seen.values())


def conversation(db: Session, user: User, other_id: uuid.UUID) -> dict:
    """One conversation. Without the reader's yes, or while it is a request they have not accepted, it
    says who and how many, so they can accept, block or report — not the words."""
    other = _other(db, other_id)
    agreed = consented(db, user.id)
    request = not hears(db, user.id, other.id) and _wrote(db, other.id, user.id)
    why_not = _may_write(db, user, other)
    out = {
        "other": _person(other),
        "consented": agreed,
        "request": request,
        "messages": [],
        "waiting": 0,
        "can_write": agreed and why_not is None and not request,
        "why_not": why_not,
        "i_blocked": why_not == "you_blocked",
        # my words wait in a request they have not accepted
        "pending": not hears(db, other.id, user.id),
    }
    rows = db.execute(select(BuddyMessage).where(_pair(user.id, other.id)).order_by(BuddyMessage.created_at)).scalars().all()
    # seen, even as a request: the header's count is about news, and this is no longer news
    now = _now()
    changed = False
    for m in rows:
        if m.recipient_id == user.id and m.read_at is None:
            m.read_at = now
            changed = True
    if changed:
        db.commit()
    if not agreed or request:
        out["waiting"] = sum(1 for m in rows if m.sender_id == other.id)
        return out
    out["messages"] = [_message_out(m, user.id) for m in rows]
    return out


def unread(db: Session, user: User) -> tuple[int, bool]:
    """(unread messages from readers, has any conversation)."""
    count = db.execute(
        select(func.count()).where(BuddyMessage.recipient_id == user.id, BuddyMessage.read_at.is_(None))
    ).scalar_one()
    if count:
        return count, True
    has = db.execute(
        select(BuddyMessage.id).where(or_(BuddyMessage.sender_id == user.id, BuddyMessage.recipient_id == user.id)).limit(1)
    ).first() is not None
    return 0, has


# ---------- writing ----------


def accept(db: Session, user: User, other_id: uuid.UUID) -> dict:
    """«Принять»: the request's words open, and both may write."""
    _need_consent(db, user)
    other = _other(db, other_id)
    if db.get(ChatAccept, (user.id, other.id)) is None:
        db.add(ChatAccept(user_id=user.id, other_id=other.id, accepted_at=_now()))
        db.commit()
    return conversation(db, user, other.id)


def _push(db: Session, sender: User, recipient: User, what: str) -> None:
    """Who wrote, never what: the words stay on our server."""
    from app.services import push

    if recipient.id in notify._muted(db, KIND):
        return
    reminder = db.get(ReadingReminder, recipient.id)
    locale = reminder.locale if reminder and reminder.locale in ("ru", "kk", "en") else "ru"
    try:
        push.send_to_user(db, recipient.id, {
            "title": _name(sender), "body": PUSH_WORDS[what][locale],
            "url": f"/messages?u={sender.id}", "tag": f"buddy-{sender.id}",
        })
    except Exception:  # someone else's push server; the message is saved
        logger.exception("buddy push failed for %s", recipient.id)


def send(db: Session, user: User, other_id: uuid.UUID, text: str) -> dict:
    _need_consent(db, user)
    other = _other(db, other_id)
    why_not = _may_write(db, user, other)
    if why_not:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=why_not)
    if not hears(db, user.id, other.id) and _wrote(db, other.id, user.id):
        # an unaccepted request to me: answering is accepting, and accepting is a tap first
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="request")
    text = (text or "").strip()[:MAX_CHARS]
    if not text:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="empty")
    since = _now() - timedelta(days=1)
    sent_today = db.execute(
        select(func.count()).where(BuddyMessage.sender_id == user.id, BuddyMessage.created_at >= since)
    ).scalar_one()
    if sent_today >= DAILY_MESSAGES:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="too_many")
    first = not _wrote(db, user.id, other.id) and not _wrote(db, other.id, user.id)
    if first:
        started = db.execute(
            select(func.count(func.distinct(BuddyMessage.recipient_id))).where(
                BuddyMessage.sender_id == user.id, BuddyMessage.created_at >= since
            )
        ).scalar_one()
        if started >= DAILY_NEW_CONVERSATIONS:
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="too_many")
    request = not hears(db, other.id, user.id)
    db.add(BuddyMessage(sender_id=user.id, recipient_id=other.id, text=text))
    db.commit()
    if not request:
        _push(db, user, other, "message")
    elif first:
        _push(db, user, other, "request")
    return conversation(db, user, other.id)


def block(db: Session, user: User, other_id: uuid.UUID, on: bool) -> dict:
    other = _other(db, other_id)
    row = db.execute(
        select(ChatBlock).where(ChatBlock.blocker_id == user.id, ChatBlock.blocked_id == other.id)
    ).scalar_one_or_none()
    if on and row is None:
        db.add(ChatBlock(blocker_id=user.id, blocked_id=other.id))
    elif not on and row is not None:
        db.delete(row)
    db.commit()
    return conversation(db, user, other.id)


def report(db: Session, user: User, other_id: uuid.UUID, reason: str) -> dict:
    """A complaint: the team gets the latest messages of this conversation, and the founder hears in
    Telegram that one came — not what it says."""
    from app.services import admin_ping

    other = _other(db, other_id)
    reason = (reason or "").strip()[:1000]
    if not reason:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="empty")
    rows = list(reversed(db.execute(
        select(BuddyMessage).where(_pair(user.id, other.id)).order_by(BuddyMessage.created_at.desc()).limit(REPORT_EXCERPT)
    ).scalars().all()))
    names = {user.id: _name(user), other.id: _name(other)}
    excerpt = "\n".join(
        f"{m.created_at.astimezone(ROUND_TZ):%d.%m %H:%M} {names.get(m.sender_id, '?')}: {m.text}" for m in rows
    )
    row = ChatReport(reporter_id=user.id, reported_id=other.id, reason=reason, excerpt=excerpt)
    db.add(row)
    db.commit()
    try:
        admin_ping.tell_admins(
            f"🚩 Жалоба в личных сообщениях: {_name(user)} (@{user.username}) на {_name(other)} (@{other.username}).\n"
            f"Ответить в течение 20 дней. Открыть: {SITE}/admin/chat-report/details/{row.id}"
        )
    except Exception:
        logger.exception("report ping failed")
    return {"ok": True}
