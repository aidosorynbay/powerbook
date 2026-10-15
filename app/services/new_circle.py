"""The first day of a month: last month's readers who have not signed up for the new circle hear that it is open — in
the bell, and as a push where they allowed pushes. Once per circle (the bell's dedupe), from 10:00 Astana time, and a
reader who switched «Новый круг» off in the bell's settings hears nothing (2026-10-15: the return that matters is the
October reader coming back in November; on the 1st nobody told them, and the daily reminder only reaches readers who
are already in a running circle).

Nothing here may break the scheduler: a failed push is logged and the next reader is tried.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.enums import RoundParticipantStatus, RoundStatus
from app.models.push import ReadingReminder
from app.models.round import Round, RoundParticipant
from app.services import notify

logger = logging.getLogger(__name__)

ZONE = ZoneInfo("Asia/Almaty")
FROM_HOUR = 10
KIND = "new_circle"

TEXTS = {
    "ru": ("Новый круг открыт", "Запишитесь в один тап — запись до {day} числа."),
    "kk": ("Жаңа шеңбер ашылды", "Бір түртумен жазылыңыз — жазылу {day}-күнге дейін."),
    "en": ("A new circle is open", "Join in one tap — sign-up is open until day {day}."),
}


def _previous(year: int, month: int) -> tuple[int, int]:
    return (year, month - 1) if month > 1 else (year - 1, 12)


def tick(db: Session, now: datetime | None = None) -> int:
    """Tell last month's readers about the new circle. Returns how many readers were told."""
    from app.services import push

    now = now or datetime.now(timezone.utc)
    local = now.astimezone(ZONE)
    if local.day != 1 or local.hour < FROM_HOUR:
        return 0
    rnd = db.execute(
        select(Round).where(Round.year == local.year, Round.month == local.month, Round.status == RoundStatus.registration_open)
    ).scalars().first()
    if rnd is None:
        return 0
    py, pm = _previous(local.year, local.month)
    prev = db.execute(select(Round).where(Round.group_id == rnd.group_id, Round.year == py, Round.month == pm)).scalars().first()
    if prev is None:
        return 0
    last_month = set(db.execute(
        select(RoundParticipant.user_id).where(RoundParticipant.round_id == prev.id, RoundParticipant.status == RoundParticipantStatus.active)
    ).scalars())
    joined = set(db.execute(select(RoundParticipant.user_id).where(RoundParticipant.round_id == rnd.id)).scalars())
    locales = dict(db.execute(select(ReadingReminder.user_id, ReadingReminder.locale)).all())
    told = 0
    for user_id in sorted(last_month - joined, key=str):
        if not notify.notify(db, user_id, KIND, {"month": rnd.month, "year": rnd.year, "round_id": str(rnd.id)}, dedupe=f"{KIND}:{rnd.id}"):
            continue
        db.commit()
        told += 1
        title, body = TEXTS.get(locales.get(user_id) or "ru", TEXTS["ru"])
        payload = {"title": title, "body": body.format(day=rnd.registration_open_until_day), "url": "/round?source=push_new_circle", "tag": "new-circle"}
        try:
            push.send_to_user(db, user_id, payload)
        except Exception:  # someone else's push server; the bell already has it
            logger.exception("new circle push failed for %s", user_id)
    return told
