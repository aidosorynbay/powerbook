"""Web push: the daily reading reminder for the app on the home screen.

The reminder is the one thing the research (2026-10-12) said the habit was
missing: a nudge at a moment the reader chose, tied to the one action —
log today's minutes. So it goes out once a day at most, at the reader's
own time, only while a circle is running, and never on a day whose 30
minutes are already in. The words change from day to day and never scold.
"""
from __future__ import annotations

import base64
import fcntl
import json
import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from cryptography.hazmat.primitives import serialization
from fastapi import HTTPException, status
from py_vapid import Vapid
from pywebpush import WebPushException, webpush
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.enums import RoundParticipantStatus, RoundStatus
from app.models.push import PushSubscription, PushVapidKey, ReadingReminder
from app.models.round import ReadingLog, Round, RoundParticipant
from app.models.user import User
from app.repositories.reading_logs import MIN_SCORING_MINUTES
from app.services.reading_room import reading_day

logger = logging.getLogger(__name__)

# Who to contact about this sender, as push services require.
VAPID_SUBJECT = "https://powerbook.kz"
# A reminder is still worth delivering this long after its time; later it
# would be yesterday's nag.
TTL_SECONDS = 6 * 3600
# How long after the chosen time the tick still counts it as due (the
# scheduler runs every minute, but the server may have been restarting).
DUE_WINDOW = timedelta(minutes=30)
_LOCK_PATH = Path("/tmp/powerbook-push.lock")
RUNNING = {RoundStatus.registration_open, RoundStatus.locked}

# The texts rotate by day so the same line never arrives twice in a row.
MESSAGES: dict[str, list[tuple[str, str]]] = {
    "ru": [
        ("Время читать", "30 минут — и сегодняшний день засчитан."),
        ("Книга ждёт", "Сегодняшние 30 минут ещё впереди."),
        ("Ваши 30 минут", "Круг читает вместе с вами. Присоединяйтесь."),
        ("Полчаса с книгой", "И сегодняшний день появится в календаре."),
        ("Понемногу, но постоянно", "Минуты за сегодня ещё не отмечены."),
    ],
    "kk": [
        ("Оқу уақыты", "30 минут — және бүгінгі күн есепке алынады."),
        ("Кітап күтіп тұр", "Бүгінгі 30 минут әлі алда."),
        ("Сіздің 30 минутыңыз", "Шеңбер сізбен бірге оқып жатыр. Қосылыңыз."),
        ("Кітаппен жарты сағат", "Сонда бүгінгі күн күнтізбеде пайда болады."),
        ("Аз-аздан, үздіксіз", "Бүгінгі минуттар әлі белгіленбеген."),
    ],
    "en": [
        ("Time to read", "30 minutes, and today counts."),
        ("Your book is waiting", "Today's 30 minutes are still ahead."),
        ("Your 30 minutes", "The circle is reading with you. Join in."),
        ("Half an hour with a book", "And today shows up on your calendar."),
        ("Little by little", "Today's minutes aren't logged yet."),
    ],
}


# ---------- keys ----------

def _public_key_b64(vapid: Vapid) -> str:
    raw = vapid.public_key.public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def vapid_keys(db: Session) -> PushVapidKey:
    """The server's key pair, made the first time anyone asks."""
    row = db.get(PushVapidKey, 1)
    if row is not None:
        return row
    vapid = Vapid()
    vapid.generate_keys()
    pem = vapid.private_pem()
    row = PushVapidKey(
        id=1,
        private_pem=pem.decode() if isinstance(pem, bytes) else pem,
        public_key=_public_key_b64(vapid),
        created_at=datetime.now(timezone.utc),
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        # The other worker got there first; its keys are the ones to use.
        db.rollback()
        row = db.get(PushVapidKey, 1)
        if row is None:
            raise
    return row


def public_key(db: Session) -> str:
    return vapid_keys(db).public_key


def _private_key_b64(pem: str) -> str:
    """The key in the one form pywebpush parses: base64url of the raw 32-byte scalar.

    Handing it the PEM looked right and failed in production (2026-10-13,
    "Could not deserialize key data"): Vapid.from_string() wants raw bytes.
    """
    key = serialization.load_pem_private_key(pem.encode(), password=None)
    raw = key.private_numbers().private_value.to_bytes(32, "big")
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


# ---------- subscriptions ----------

def subscribe(
    db: Session,
    user: User,
    *,
    endpoint: str,
    p256dh: str,
    auth: str,
    user_agent: str | None,
    display_mode: str | None,
) -> PushSubscription:
    row = db.execute(select(PushSubscription).where(PushSubscription.endpoint == endpoint)).scalar_one_or_none()
    if row is None:
        row = PushSubscription(user_id=user.id, endpoint=endpoint, p256dh=p256dh, auth=auth)
        db.add(row)
    # A phone passed on, or a new login on the same browser: the endpoint
    # now belongs to whoever is signed in.
    row.user_id = user.id
    row.p256dh = p256dh
    row.auth = auth
    row.user_agent = (user_agent or "")[:300] or None
    row.display_mode = (display_mode or "")[:20] or None
    db.commit()
    return row


def unsubscribe(db: Session, user: User, endpoint: str) -> bool:
    row = db.execute(
        select(PushSubscription).where(PushSubscription.endpoint == endpoint, PushSubscription.user_id == user.id)
    ).scalar_one_or_none()
    if row is None:
        return False
    db.delete(row)
    db.commit()
    return True


def subscriptions_for(db: Session, user_id: uuid.UUID) -> list[PushSubscription]:
    return list(db.execute(select(PushSubscription).where(PushSubscription.user_id == user_id)).scalars().all())


# ---------- the reminder itself ----------

def _zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="unknown_timezone")


def reminder_state(db: Session, user_id: uuid.UUID) -> dict:
    row = db.get(ReadingReminder, user_id)
    subs = subscriptions_for(db, user_id)
    return {
        "enabled": bool(row and row.enabled),
        "hour": row.hour if row else 21,
        "minute": row.minute if row else 0,
        "tz": row.tz if row else "Asia/Almaty",
        "locale": row.locale if row else "ru",
        "note": row.note if row else None,
        "subscriptions": len(subs),
    }


def save_reminder(
    db: Session, user: User, *, enabled: bool, hour: int, minute: int, tz: str, locale: str, note: str | None = None
) -> dict:
    _zone(tz)
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="bad_time")
    row = db.get(ReadingReminder, user.id)
    if row is None:
        row = ReadingReminder(user_id=user.id)
        db.add(row)
    changed_time = row.hour != hour or row.minute != minute or row.tz != tz
    row.enabled = enabled
    row.hour = hour
    row.minute = minute
    row.tz = tz
    row.locale = locale if locale in MESSAGES else "ru"
    row.note = (note or "").strip()[:200] or None
    # A new time should fire today if it is still ahead.
    if changed_time:
        row.last_sent_on = None
    db.commit()
    return reminder_state(db, user.id)


def _message(locale: str, user_id: uuid.UUID, day: date) -> tuple[str, str]:
    options = MESSAGES.get(locale) or MESSAGES["ru"]
    return options[(user_id.int + day.toordinal()) % len(options)]


def send(db: Session, sub: PushSubscription, payload: dict) -> bool:
    """One push to one browser. A dead subscription (404/410) is dropped."""
    keys = vapid_keys(db)
    try:
        webpush(
            subscription_info={"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
            data=json.dumps(payload, ensure_ascii=False),
            vapid_private_key=_private_key_b64(keys.private_pem),
            vapid_claims={"sub": VAPID_SUBJECT},
            ttl=TTL_SECONDS,
        )
    except WebPushException as exc:
        code = getattr(getattr(exc, "response", None), "status_code", None)
        if code in (404, 410):
            db.delete(sub)
            db.commit()
            return False
        logger.warning("push failed for %s: %s", sub.user_id, exc)
        return False
    except Exception as exc:  # the push service is someone else's server
        logger.warning("push failed for %s: %s", sub.user_id, exc)
        return False
    sub.last_sent_at = datetime.now(timezone.utc)
    db.commit()
    return True


def send_to_user(db: Session, user_id: uuid.UUID, payload: dict) -> int:
    return sum(send(db, sub, payload) for sub in subscriptions_for(db, user_id))


def test_message(locale: str, note: str | None = None) -> dict:
    title, _ = _message(locale, uuid.UUID(int=0), date.today())
    body = note or {
        "ru": "Пробное уведомление. Напоминания будут приходить так же.",
        "kk": "Сынақ хабарлама. Еске салулар дәл осылай келеді.",
        "en": "A test notification. Reminders will arrive like this.",
    }.get(locale, "Пробное уведомление.")
    return {"title": title, "body": body, "url": "/round?source=push", "tag": "reading-reminder"}


def _in_running_round(db: Session, user_id: uuid.UUID) -> bool:
    stmt = (
        select(RoundParticipant.id)
        .join(Round, Round.id == RoundParticipant.round_id)
        .where(
            RoundParticipant.user_id == user_id,
            RoundParticipant.status == RoundParticipantStatus.active,
            Round.status.in_(RUNNING),
        )
        .limit(1)
    )
    return db.execute(stmt).first() is not None


def _read_today(db: Session, user_id: uuid.UUID, day: date) -> bool:
    stmt = select(ReadingLog.minutes).where(ReadingLog.user_id == user_id, ReadingLog.date == day)
    return any(m >= MIN_SCORING_MINUTES for (m,) in db.execute(stmt).all())


def due(reminder: ReadingReminder, now: datetime) -> date | None:
    """The reader's local date, if their time has come today and nothing went out yet."""
    try:
        local = now.astimezone(ZoneInfo(reminder.tz))
    except (ZoneInfoNotFoundError, ValueError):
        local = now.astimezone(ZoneInfo("Asia/Almaty"))
    if reminder.last_sent_on == local.date():
        return None
    at = local.replace(hour=reminder.hour, minute=reminder.minute, second=0, microsecond=0)
    if at <= local < at + DUE_WINDOW:
        return local.date()
    return None


def tick(db: Session, now: datetime | None = None) -> int:
    """Send every reminder whose time has come. Returns how many went out."""
    now = now or datetime.now(timezone.utc)
    sent = 0
    rows = db.execute(select(ReadingReminder).where(ReadingReminder.enabled.is_(True))).scalars().all()
    for reminder in rows:
        local_day = due(reminder, now)
        if local_day is None:
            continue
        # Whatever happens next, today is dealt with.
        reminder.last_sent_on = local_day
        db.commit()
        if not _in_running_round(db, reminder.user_id):
            continue
        if _read_today(db, reminder.user_id, reading_day(now)):
            continue
        title, body = _message(reminder.locale, reminder.user_id, local_day)
        # The reader's own cue beats our words.
        if reminder.note:
            body = reminder.note
        payload = {"title": title, "body": body, "url": "/round?source=push", "tag": "reading-reminder"}
        sent += send_to_user(db, reminder.user_id, payload)
    return sent


def scheduled() -> None:
    """The scheduler's tick: one process at a time across the workers."""
    from app.db.session import get_session_factory

    _LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(_LOCK_PATH, "w") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            return
        db = get_session_factory()()
        try:
            tick(db)
        except Exception:
            logger.exception("push reminder tick failed")
            db.rollback()
        try:
            # the 1st of a month: last month's readers hear the new circle is open (once per circle)
            from app.services import new_circle

            new_circle.tick(db)
        except Exception:
            logger.exception("new circle tick failed")
            db.rollback()
        finally:
            db.close()
            fcntl.flock(handle, fcntl.LOCK_UN)
