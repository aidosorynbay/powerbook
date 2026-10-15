"""«Хей, как вы, всё ок?» — the founder's word to a reader who has gone quiet.

How it was (the founder, 2026-10-15): he watched the circle's table, and
when someone had not logged their minutes for more than three days he wrote
to them in Telegram: «Хей, как вы, всё ок?». Then they talked; he cheered
them on and gave advice where it helped. He asked for the same, on the site,
without Telegram for the readers, and still feeling like a person.

The council's answer (2026-10-15): automate the noticing, not the caring.

- At 10:00 Astana time the site lists the readers of a running circle who
  have logged nothing for the last three full days, and the bot sends the
  founder that list in Telegram: «✅ Отправить всем», «❌ <имя>».
- Nothing goes out without his ✅ (CHECKIN_AUTO=true sends it on its own,
  with an honest line that the site told him). An unapproved list expires
  with its day.
- Approved messages reach the reader between 11:00 and 20:00 of their own
  time: in their conversation with the founder (/messages, the speech
  bubble beside the bell; the bell itself stays out of it: one message,
  one signal), as a push where they allowed pushes, and on top of «Круг»,
  with quick answers («Читаю — отмечу сейчас», «Всё ок», and under «Ещё»
  «Сейчас сложный период», «Пока не участвую») or their own words.
- Whatever the reader answers reaches the founder in Telegram at once; he
  answers in /messages, in his own words.

Never twice for one pause (a pause is known by the last day read before it),
never in the circle's first three days, never to someone who has left it or
switched «Личные сообщения» off, never at night. A reader who comes back
before the message goes out does not get it.

Nothing here may break the scheduler or what a reader was doing.
"""
from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.checkin import Checkin, DirectMessage
from app.models.enums import RoundParticipantStatus, RoundStatus, SystemRole
from app.models.push import ReadingReminder
from app.models.round import ReadingLog, ReadingLogBook, Round, RoundParticipant
from app.models.user import User
from app.services import notify
from app.core.constants import ROUND_TZ
from app.services.reading_room import reading_day

logger = logging.getLogger(__name__)

KIND = "checkin"
SITE = "https://powerbook.kz"
# Three full days without a word, as the founder used to count.
QUIET_DAYS = 3
PLAN_FROM_HOUR = 10
# The reader's own clock: never before or after these.
SEND_FROM_HOUR = 11
SEND_UNTIL_HOUR = 20
# An approved message still worth sending this many days after it was noticed.
STALE_AFTER_DAYS = 2
# How long the card on «Круг» waits for an answer.
CARD_DAYS = 3
MAX_CHARS = 2000
RUNNING = (RoundStatus.registration_open, RoundStatus.locked)

# In the founder's words; the reader's book, when we know it, makes it theirs.
TEXTS: dict[str, dict[str, list[str]]] = {
    "ru": {
        "plain": [
            "Хей, как вы, всё ок?",
            "Хей! Несколько дней вас не видно в круге — как вы? Всё хорошо?",
            "Привет! Как вы? Давно не слышно — всё в порядке?",
        ],
        "book": ["Хей, как вы, всё ок? Как идёт «{book}»?"],
        "auto": "PowerBook подсказывает мне, когда кто-то пропадает, а отвечаю я сам.",
    },
    "kk": {
        "plain": [
            "Сәлем, қалайсыз, бәрі жақсы ма?",
            "Сәлем! Бірнеше күн шеңберде көрінбей кеттіңіз — қалайсыз? Бәрі жақсы ма?",
            "Сәлеметсіз бе! Қалайсыз? Біраз уақыт хабар болмады — бәрі дұрыс па?",
        ],
        "book": ["Сәлем, қалайсыз, бәрі жақсы ма? «{book}» қалай жүріп жатыр?"],
        "auto": "Біреу жоғалып кетсе, PowerBook маған айтып отырады, ал жауапты өзім жазамын.",
    },
    "en": {
        "plain": [
            "Hey, how are you, all good?",
            "Hey! Haven't seen you in the circle for a few days — how are you? All well?",
            "Hi! How are you? It's been quiet for a bit — everything okay?",
        ],
        "book": ["Hey, how are you, all good? How is «{book}» going?"],
        "auto": "PowerBook tells me when someone goes quiet; the answers are mine.",
    },
}

# The quick answers, as they appear in the conversation.
ANSWERS: dict[str, dict[str, str]] = {
    "forgot": {"ru": "Читаю, просто забыл(а) отметить", "kk": "Оқып жүрмін, тек белгілеуді ұмытып кеттім", "en": "I'm reading, just forgot to log it"},
    "ok": {"ru": "Всё ок, скоро вернусь", "kk": "Бәрі жақсы, жақында ораламын", "en": "All good, back soon"},
    "hard": {"ru": "Сейчас сложный период", "kk": "Қазір қиын кезең", "en": "It's a hard time right now"},
    "out": {"ru": "Пока не участвую", "kk": "Әзірге қатыспаймын", "en": "Not taking part for now"},
}
ANSWER_ICONS = {"forgot": "📖", "ok": "🙂", "hard": "🫂", "out": "👋"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _is_admin(user: User) -> bool:
    return user.system_role in {SystemRole.admin, SystemRole.superadmin}


def _name(user: User | None) -> str:
    return (user.display_name or user.username) if user else "—"


def sender(db: Session) -> User | None:
    """Whose name the messages go out in."""
    if settings.checkin_from_username:
        user = db.execute(select(User).where(User.username == settings.checkin_from_username)).scalar_one_or_none()
        if user is not None:
            return user
    return db.execute(
        select(User).where(User.system_role == SystemRole.superadmin, User.is_active.is_(True)).order_by(User.created_at)
    ).scalars().first()


def _locale(db: Session, user_id: uuid.UUID) -> str:
    row = db.get(ReadingReminder, user_id)
    return row.locale if row and row.locale in TEXTS else "ru"


def _zone(db: Session, user_id: uuid.UUID) -> ZoneInfo:
    row = db.get(ReadingReminder, user_id)
    try:
        return ZoneInfo(row.tz) if row and row.tz else ROUND_TZ
    except (ZoneInfoNotFoundError, ValueError):
        return ROUND_TZ


def _last_book(db: Session, round_id: uuid.UUID, user_id: uuid.UUID) -> str | None:
    title = db.execute(
        select(ReadingLogBook.title)
        .join(ReadingLog, ReadingLog.id == ReadingLogBook.reading_log_id)
        .where(ReadingLog.round_id == round_id, ReadingLog.user_id == user_id, ReadingLogBook.finished.is_(False))
        .order_by(ReadingLog.date.desc(), ReadingLogBook.position)
        .limit(1)
    ).scalar_one_or_none()
    return title.strip()[:80] if title and title.strip() else None


# The founder's own words (2026-10-15): in Kazakh, to women and to men as he greets them. Readers
# who chose English get the English line.
GREETINGS = {
    "female": "Сәлеем, қалайсыз? Кітап оқу қалай болып жатыр?",
    "male": "Ассаламу алейкум, қалайсыздар? Осы ай айналымы қалай өтіп жатыр екен?",
}


def compose(locale: str, seed: int, book: str | None, gender: str | None = None) -> str:
    words = TEXTS.get(locale) or TEXTS["ru"]
    if locale != "en":
        text = GREETINGS.get(gender or "", GREETINGS["female"])
        words = TEXTS["kk"]
    elif book and seed % 2 == 0:
        options = words["book"]
        text = options[seed % len(options)].format(book=book)
    else:
        options = words["plain"]
        text = options[seed % len(options)]
    if settings.checkin_auto:
        text = f"{text}\n\n{words['auto']}"
    return text


# ---------- noticing ----------


def quiet_readers(db: Session, today: date) -> list[tuple[RoundParticipant, Round, date]]:
    """Who in a running circle logged nothing for the last three full days:
    (participant, circle, the last day they read before the pause)."""
    first_quiet = today - timedelta(days=QUIET_DAYS)
    rounds = [r for r in db.execute(select(Round).where(Round.status.in_(RUNNING))).scalars() if r.covers(today)]
    out = []
    for rnd in rounds:
        # Never in a circle's first days: there is nothing to be quiet about yet.
        if rnd.first_day_date > first_quiet:
            continue
        read = dict(db.execute(
            select(ReadingLog.user_id, func.max(ReadingLog.date))
            .where(ReadingLog.round_id == rnd.id, ReadingLog.minutes > 0)
            .group_by(ReadingLog.user_id)
        ).all())
        participants = db.execute(
            select(RoundParticipant).where(
                RoundParticipant.round_id == rnd.id, RoundParticipant.status == RoundParticipantStatus.active
            )
        ).scalars().all()
        for p in participants:
            last = read.get(p.user_id)
            if last is not None and last >= first_quiet:
                continue
            # Someone who joined in the middle of the pause has not been quiet for three days.
            if p.joined_at and p.joined_at.astimezone(ROUND_TZ).date() > first_quiet:
                continue
            out.append((p, rnd, last or (rnd.first_day_date - timedelta(days=1))))
    return out


def plan(db: Session, now: datetime | None = None) -> list[Checkin]:
    """The morning's list: a planned message for each new pause. Returns the new ones."""
    now = now or _now()
    if now.astimezone(ROUND_TZ).hour < PLAN_FROM_HOUR:
        return []
    today = reading_day(now)
    # Yesterday's list nobody said yes to is gone with its day.
    for row in db.execute(select(Checkin).where(Checkin.status == "planned", Checkin.day < today)).scalars():
        row.status = "expired"
    db.commit()
    quiet = quiet_readers(db, today)
    if not quiet:
        return []
    who_sends = sender(db)
    muted = notify._muted(db, KIND)
    created = []
    for p, rnd, last_read in quiet:
        if p.user_id in muted or (who_sends and p.user_id == who_sends.id):
            continue
        user = db.get(User, p.user_id)
        if user is None or not user.is_active or user.is_claimable:
            continue
        exists = db.execute(
            select(Checkin.id).where(Checkin.user_id == p.user_id, Checkin.round_id == rnd.id, Checkin.last_read == last_read)
        ).first()
        if exists:
            continue
        seed = p.user_id.int + today.toordinal()
        row = Checkin(
            user_id=p.user_id,
            round_id=rnd.id,
            last_read=last_read,
            day=today,
            status="approved" if settings.checkin_auto else "planned",
            text=compose(_locale(db, p.user_id), seed, _last_book(db, rnd.id, p.user_id), getattr(user.gender, "value", None)),
        )
        db.add(row)
        try:
            db.commit()
        except IntegrityError:  # the other worker noticed the same pause
            db.rollback()
            continue
        created.append(row)
    if created:
        _tell_founder_list(db, today, created)
    return created


# ---------- the founder's morning message ----------


def _when(last_read: date, rnd_first: date, user: User | None = None) -> str:
    gender = getattr(getattr(user, "gender", None), "value", None)
    ending = {"female": "а", "male": ""}.get(gender, "(а)")
    if last_read < rnd_first:
        return f"в этом круге ещё не отмечал{ending}"
    return f"последний раз читал{ending} {last_read:%d.%m}"


def _list_text(db: Session, day: date, rows: list[Checkin]) -> str:
    lines = [f"☕ Молчат 3+ дня: {len(rows)}", ""]
    for i, row in enumerate(rows, 1):
        user = db.get(User, row.user_id)
        rnd = db.get(Round, row.round_id)
        handle = f" (@{user.username})" if user else ""
        lines.append(f"{i}. {_name(user)}{handle} — {_when(row.last_read, rnd.first_day_date if rnd else row.last_read, user)}")
        lines.append(f"   «{row.text.splitlines()[0]}»")
    lines.append("")
    if settings.checkin_auto:
        lines.append("Напишу им сам днём (11:00–20:00 по их времени).")
    else:
        lines.append("✅ — напишу им от вашего имени днём (11:00–20:00 по их времени). Без нажатия ничего не уйдёт.")
    if day.weekday() == 0:
        s = stats(db, days=7, today=day)
        lines.append(f"\nЗа неделю: написали {s['sent']}, ответили {s['answered']}, вернулись за 2 дня {s['returned']}.")
    who = sender(db)
    lines.append(f"Подпись: {_name(who)}" + ("" if who is None or who.avatar_data else " (без фото — поставьте в профиле)"))
    lines.append(f"Переписки: {SITE}/messages")
    return "\n".join(lines)


def _keyboard(db: Session, day: date) -> list[list[dict]]:
    planned = db.execute(
        select(Checkin).where(Checkin.day == day, Checkin.status == "planned").order_by(Checkin.created_at)
    ).scalars().all()
    if not planned:
        return []
    rows = [[{"text": f"✅ Отправить всем ({len(planned)})", "callback_data": f"ci:all:{day.isoformat()}"}]]
    skip = [{"text": f"❌ {_name(db.get(User, c.user_id))[:24]}", "callback_data": f"ci:x:{c.id}"} for c in planned]
    rows += [skip[i:i + 2] for i in range(0, len(skip), 2)]
    return rows


def _tell_founder_list(db: Session, day: date, rows: list[Checkin]) -> None:
    from app.services import admin_ping

    try:
        buttons = None if settings.checkin_auto else _keyboard(db, day)
        admin_ping.tell_admins(_list_text(db, day, rows), buttons=buttons or None)
    except Exception:
        logger.exception("check-in list to the founder failed")


def decide(db: Session, data: str) -> tuple[str, str | None, list[list[dict]] | None]:
    """The founder's button: «ci:all:<day>» or «ci:x:<checkin id>».
    Returns (the short answer, a line for under the message, the buttons left)."""
    _, verb, arg = data.split(":", 2)
    if verb == "all":
        day = date.fromisoformat(arg)
        rows = db.execute(select(Checkin).where(Checkin.day == day, Checkin.status == "planned")).scalars().all()
        if not rows:
            return ("Список истёк" if day < reading_day() else "Уже решено"), None, []
        for row in rows:
            row.status = "approved"
        db.commit()
        names = ", ".join(_name(db.get(User, r.user_id)) for r in rows)
        return "✅ Отправлю", f"✅ Отправлю днём: {names}", []
    row = db.get(Checkin, uuid.UUID(arg))
    if row is None or row.status != "planned":
        return "Уже решено", None, None
    row.status = "skipped"
    db.commit()
    return "Не пишу", f"❌ Не писать: {_name(db.get(User, row.user_id))}", _keyboard(db, row.day)


def approve_day(db: Session, day: date) -> int:
    rows = db.execute(select(Checkin).where(Checkin.day == day, Checkin.status == "planned")).scalars().all()
    for row in rows:
        row.status = "approved"
    db.commit()
    return len(rows)


def skip(db: Session, checkin_id: uuid.UUID) -> None:
    row = db.get(Checkin, checkin_id)
    if row is not None and row.status in ("planned", "approved"):
        row.status = "skipped"
        db.commit()


# ---------- sending ----------


def _came_back(db: Session, row: Checkin) -> bool:
    return db.execute(
        select(ReadingLog.id).where(
            ReadingLog.user_id == row.user_id, ReadingLog.round_id == row.round_id,
            ReadingLog.date > row.last_read, ReadingLog.minutes > 0,
        ).limit(1)
    ).first() is not None


def _still_in(db: Session, row: Checkin) -> bool:
    return db.execute(
        select(RoundParticipant.id).where(
            RoundParticipant.round_id == row.round_id, RoundParticipant.user_id == row.user_id,
            RoundParticipant.status == RoundParticipantStatus.active,
        )
    ).first() is not None


def deliver(db: Session, now: datetime | None = None) -> int:
    """Send the approved messages whose reader's afternoon it is. Returns how many went."""
    from app.services import push

    now = now or _now()
    today = reading_day(now)
    who_sends = sender(db)
    if who_sends is None:
        return 0
    sent = 0
    for row in db.execute(select(Checkin).where(Checkin.status == "approved")).scalars().all():
        if row.day < today - timedelta(days=STALE_AFTER_DAYS):
            row.status = "expired"
            db.commit()
            continue
        # back on their own, out of the circle, or «Личные сообщения» switched off since the ✅
        if _came_back(db, row) or not _still_in(db, row) or row.user_id in notify._muted(db, KIND):
            row.status = "cancelled"
            db.commit()
            continue
        hour = now.astimezone(_zone(db, row.user_id)).hour
        if not SEND_FROM_HOUR <= hour < SEND_UNTIL_HOUR:
            continue
        row.status = "sent"
        row.sent_at = now
        db.add(DirectMessage(reader_id=row.user_id, author_id=who_sends.id, text=row.text, checkin_id=row.id))
        db.commit()
        sent += 1
        try:
            push.send_to_user(db, row.user_id, {
                "title": _name(who_sends), "body": row.text.splitlines()[0],
                "url": "/round?source=push_checkin", "tag": "checkin",
            })
        except Exception:  # someone else's push server; the site already has it
            logger.exception("check-in push failed for %s", row.user_id)
    return sent


def tick(db: Session, now: datetime | None = None) -> None:
    plan(db, now)
    deliver(db, now)


# ---------- the reader's side ----------


def _message_out(msg: DirectMessage, author: User | None, viewer: User) -> dict:
    return {
        "id": str(msg.id),
        "text": msg.text,
        "created_at": msg.created_at,
        "mine": msg.author_id == viewer.id,
        "from_reader": msg.author_id == msg.reader_id,
        "author": _name(author),
        "avatar_data": author.avatar_data if author else None,
    }


def _thread(db: Session, reader_id: uuid.UUID, viewer: User) -> list[dict]:
    rows = db.execute(
        select(DirectMessage).where(DirectMessage.reader_id == reader_id).order_by(DirectMessage.created_at)
    ).scalars().all()
    authors = {u.id: u for u in db.execute(select(User).where(User.id.in_({m.author_id for m in rows}))).scalars()} if rows else {}
    return [_message_out(m, authors.get(m.author_id), viewer) for m in rows]


def _mark_read(db: Session, reader_id: uuid.UUID, *, by_reader: bool) -> None:
    stmt = select(DirectMessage).where(DirectMessage.reader_id == reader_id, DirectMessage.read_at.is_(None))
    stmt = stmt.where(DirectMessage.author_id != reader_id) if by_reader else stmt.where(DirectMessage.author_id == reader_id)
    now = _now()
    changed = False
    for msg in db.execute(stmt).scalars():
        msg.read_at = now
        changed = True
    if changed:
        db.commit()


def card(db: Session, user: User) -> dict | None:
    """The message on top of «Круг»: the latest one, until it is answered (or three days pass)."""
    row = db.execute(
        select(Checkin).where(
            Checkin.user_id == user.id, Checkin.status == "sent", Checkin.answer.is_(None),
            Checkin.sent_at >= _now() - timedelta(days=CARD_DAYS),
        ).order_by(Checkin.sent_at.desc())
    ).scalars().first()
    if row is None:
        return None
    who = sender(db)
    rnd = db.get(Round, row.round_id)
    # «Пока не участвую» only while the circle still takes sign-ups and leavings (to the 10th):
    # after that the reader is in it to the end, and the answer would promise what it cannot do
    # (the founder, 2026-10-15).
    can_step_out = rnd is not None and reading_day().day <= rnd.registration_open_until_day
    return {
        "id": str(row.id),
        "text": row.text,
        "answers": [k for k in ANSWERS if k != "out" or can_step_out],
        "from": _name(who),
        "avatar_data": who.avatar_data if who else None,
        "sent_at": row.sent_at,
    }


def my_thread(db: Session, user: User) -> dict:
    messages = _thread(db, user.id, user)
    _mark_read(db, user.id, by_reader=True)
    who = sender(db)
    return {"messages": messages, "founder": _name(who), "founder_avatar": who.avatar_data if who else None, "card": card(db, user)}


def _clean(text: str) -> str:
    text = (text or "").strip()
    if not text:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="empty")
    return text[:MAX_CHARS]


def answer(db: Session, user: User, checkin_id: uuid.UUID, kind: str, locale: str) -> dict:
    """A quick answer under the message: it goes into the conversation and to the founder."""
    if kind not in ANSWERS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="unknown_answer")
    shown = card(db, user)
    if shown is not None and kind not in shown["answers"]:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="answer_closed")
    row = db.get(Checkin, checkin_id)
    if row is None or row.user_id != user.id or row.status != "sent":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="checkin_not_found")
    if row.answer is None:
        row.answer = kind
        row.answered_at = _now()
        text = ANSWERS[kind].get(locale) or ANSWERS[kind]["ru"]
        db.add(DirectMessage(reader_id=user.id, author_id=user.id, text=text, checkin_id=row.id))
        db.commit()
        _tell_founder_answer(user, f"{ANSWER_ICONS[kind]} {ANSWERS[kind]['ru']}")
    return my_thread(db, user)


# The reader's words go straight to the founder's Telegram: not without end.
DAILY_WRITES = 20


def write(db: Session, user: User, text: str) -> dict:
    """The reader's own words to the founder, in a conversation he opened."""
    text = _clean(text)
    if db.execute(select(DirectMessage.id).where(DirectMessage.reader_id == user.id).limit(1)).first() is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="no_conversation")
    today = db.execute(
        select(func.count()).where(
            DirectMessage.reader_id == user.id, DirectMessage.author_id == user.id,
            DirectMessage.created_at >= _now() - timedelta(days=1),
        )
    ).scalar_one()
    if today >= DAILY_WRITES:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="too_many")
    db.add(DirectMessage(reader_id=user.id, author_id=user.id, text=text))
    # Writing answers the card too.
    row = db.execute(
        select(Checkin).where(Checkin.user_id == user.id, Checkin.status == "sent", Checkin.answer.is_(None))
        .order_by(Checkin.sent_at.desc())
    ).scalars().first()
    if row is not None:
        row.answer = "text"
        row.answered_at = _now()
    db.commit()
    _tell_founder_answer(user, f"«{text[:1500]}»")
    return my_thread(db, user)


def _tell_founder_answer(user: User, what: str) -> None:
    from app.services import admin_ping

    try:
        admin_ping.tell_admins(f"💬 {_name(user)} (@{user.username}): {what}\nОтветить: {SITE}/messages?r={user.id}")
    except Exception:
        logger.exception("check-in answer to the founder failed")


def unread(db: Session, user: User) -> dict:
    """For the header: messages waiting for this person."""
    if _is_admin(user):
        count = db.execute(
            select(func.count()).where(DirectMessage.author_id == DirectMessage.reader_id, DirectMessage.read_at.is_(None))
        ).scalar_one()
        return {"count": count, "has_thread": True}
    count = db.execute(
        select(func.count()).where(
            DirectMessage.reader_id == user.id, DirectMessage.author_id != user.id, DirectMessage.read_at.is_(None)
        )
    ).scalar_one()
    has = count > 0 or db.execute(select(DirectMessage.id).where(DirectMessage.reader_id == user.id).limit(1)).first() is not None
    return {"count": count, "has_thread": has}


# ---------- the founder's side ----------


def threads(db: Session) -> list[dict]:
    """Every conversation, the ones waiting for an answer first."""
    last = (
        select(DirectMessage.reader_id, func.max(DirectMessage.created_at).label("at"))
        .group_by(DirectMessage.reader_id).subquery()
    )
    rows = db.execute(
        select(DirectMessage).join(last, (DirectMessage.reader_id == last.c.reader_id) & (DirectMessage.created_at == last.c.at))
    ).scalars().all()
    waiting = dict(db.execute(
        select(DirectMessage.reader_id, func.count())
        .where(DirectMessage.author_id == DirectMessage.reader_id, DirectMessage.read_at.is_(None))
        .group_by(DirectMessage.reader_id)
    ).all())
    out = []
    for msg in rows:
        reader = db.get(User, msg.reader_id)
        if reader is None:
            continue
        out.append({
            "reader_id": str(reader.id),
            "name": _name(reader),
            "username": reader.username,
            "avatar_data": reader.avatar_data,
            "last_text": msg.text[:140],
            "last_at": msg.created_at,
            "last_from_reader": msg.author_id == msg.reader_id,
            "unread": waiting.get(reader.id, 0),
        })
    out.sort(key=lambda t: (t["unread"] == 0, -t["last_at"].timestamp()))
    return out


def thread_for(db: Session, admin: User, reader_id: uuid.UUID) -> dict:
    reader = db.get(User, reader_id)
    if reader is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="reader_not_found")
    messages = _thread(db, reader_id, admin)
    _mark_read(db, reader_id, by_reader=False)
    return {"reader_id": str(reader.id), "name": _name(reader), "username": reader.username,
            "avatar_data": reader.avatar_data, "messages": messages, "context": _context(db, reader)}


def _context(db: Session, reader: User) -> str | None:
    """A line above the conversation, so the answer can be about them: the last day read and the book."""
    row = db.execute(
        select(Checkin).where(Checkin.user_id == reader.id).order_by(Checkin.created_at.desc())
    ).scalars().first()
    if row is None:
        return None
    rnd = db.get(Round, row.round_id)
    parts = [_when(row.last_read, rnd.first_day_date if rnd else row.last_read, reader)]
    book = _last_book(db, row.round_id, reader.id)
    if book:
        parts.append(f"читает «{book}»")
    return " · ".join(parts)


def reply(db: Session, admin: User, reader_id: uuid.UUID, text: str) -> dict:
    """The founder answers: the reader hears in the bell and by push."""
    from app.services import push

    text = _clean(text)
    reader = db.get(User, reader_id)
    if reader is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="reader_not_found")
    db.add(DirectMessage(reader_id=reader_id, author_id=admin.id, text=text))
    db.commit()
    try:
        push.send_to_user(db, reader_id, {"title": _name(admin), "body": text[:140], "url": "/messages?source=push", "tag": "checkin-reply"})
    except Exception:
        logger.exception("reply push failed for %s", reader_id)
    return thread_for(db, admin, reader_id)


def today_list(db: Session, now: datetime | None = None) -> dict:
    """The morning's list on the site too, in case Telegram is down."""
    today = reading_day(now or _now())
    rows = db.execute(
        select(Checkin).where(Checkin.day >= today - timedelta(days=STALE_AFTER_DAYS))
        .order_by(Checkin.day.desc(), Checkin.created_at)
    ).scalars().all()
    out = []
    for row in rows:
        user = db.get(User, row.user_id)
        rnd = db.get(Round, row.round_id)
        out.append({
            "id": str(row.id), "day": row.day, "status": row.status, "text": row.text,
            "reader_id": str(row.user_id), "name": _name(user),
            "when": _when(row.last_read, rnd.first_day_date if rnd else row.last_read, user),
            "answer": row.answer,
        })
    return {"today": today, "auto": settings.checkin_auto, "items": out, "stats": stats(db, days=30, today=today)}


def stats(db: Session, *, days: int = 30, today: date | None = None) -> dict:
    """Did it help: of those written to, who answered, and who read again within two days."""
    today = today or reading_day()
    rows = db.execute(
        select(Checkin).where(Checkin.status == "sent", Checkin.day > today - timedelta(days=days))
    ).scalars().all()
    returned = 0
    for row in rows:
        start = reading_day(row.sent_at) if row.sent_at else row.day
        came = db.execute(
            select(ReadingLog.id).where(
                ReadingLog.user_id == row.user_id, ReadingLog.minutes > 0,
                ReadingLog.date >= start, ReadingLog.date <= start + timedelta(days=2),
            ).limit(1)
        ).first()
        returned += came is not None
    return {
        "sent": len(rows),
        "answered": sum(1 for r in rows if r.answer),
        "returned": returned,
        "answers": {k: sum(1 for r in rows if r.answer == k) for k in (*ANSWERS, "text")},
    }
