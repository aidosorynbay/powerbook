"""/admin → «Стикеры»: which of the four story stickers readers take.

All four went live together in October 2026, each reader starting on a random
one, so that at the end of the month the founder can see which one readers
actually use. Google Analytics undercounts them (it sends its events about
five seconds late, and on an iPhone the reader is in Instagram by then), so
the count here comes from our own table, sticker_uses.
"""
from __future__ import annotations

import inspect
from collections import defaultdict
from datetime import date, datetime, timezone

from sqladmin import BaseView, expose
from sqlalchemy import func, select
from starlette.requests import Request

from app.core.constants import ROUND_TZ
from app.db.session import get_session_factory
from app.models.sticker_use import StickerUse
from app.models.user import User

STICKERS = [
    ("page", "Страница"),
    ("shelf", "Полка"),
    ("calendar", "Календарь"),
    ("shelfCalendar", "Полка с календарём"),
]
_NAMES = dict(STICKERS)
_DONE = {"copy": "скопировали", "save": "сохранили", "download": "скачали", "share": "отправили"}
_INK = {"light": "белый", "dark": "чёрный"}
MONTHS = ["", "январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"]


def _ru(n: int, one: str, few: str, many: str) -> str:
    if n % 10 == 1 and n % 100 != 11:
        return f"{n} {one}"
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return f"{n} {few}"
    return f"{n} {many}"


def _month_bounds(year: int, month: int) -> tuple[date, date]:
    first = date(year, month, 1)
    after = date(year + (month == 12), month % 12 + 1, 1)
    return first, after


def build(db, year: int, month: int) -> dict:
    """The month's sticker uses: per sticker, what was done with it and by how many readers."""
    first, after = _month_bounds(year, month)
    in_month = (StickerUse.day >= first, StickerUse.day < after)

    counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    rows = db.execute(
        select(StickerUse.template, StickerUse.channel, StickerUse.action, func.count())
        .where(*in_month)
        .group_by(StickerUse.template, StickerUse.channel, StickerUse.action)
    ).all()
    for template, channel, action, n in rows:
        c = counts[template]
        if channel == "story":
            c["picture"] += n
        elif action == "copy":
            c["copied"] += n
        else:
            c["saved"] += n
        c["total"] += n
    readers = dict(
        db.execute(
            select(StickerUse.template, func.count(func.distinct(StickerUse.user_id)))
            .where(*in_month)
            .group_by(StickerUse.template)
        ).all()
    )
    inks = dict(
        db.execute(select(StickerUse.ink, func.count()).where(*in_month).group_by(StickerUse.ink)).all()
    )

    table = []
    for key, name in STICKERS:
        c = counts.get(key, {})
        table.append({
            "key": key, "name": name, "copied": c.get("copied", 0), "saved": c.get("saved", 0),
            "picture": c.get("picture", 0), "total": c.get("total", 0), "readers": readers.get(key, 0),
        })
    top = max((r["total"] for r in table), default=0)
    for r in table:
        r["share"] = round(100 * r["total"] / top) if top else 0
        r["leader"] = top > 0 and r["total"] == top

    recent = []
    for use, username, display_name in db.execute(
        select(StickerUse, User.username, User.display_name)
        .join(User, User.id == StickerUse.user_id)
        .where(*in_month)
        .order_by(StickerUse.created_at.desc())
        .limit(40)
    ).all():
        at = use.created_at if use.created_at.tzinfo else use.created_at.replace(tzinfo=timezone.utc)
        recent.append({
            "at": at.astimezone(ROUND_TZ).strftime("%d.%m %H:%M"),
            "reader": f"@{username}" if username else display_name,
            "sticker": _NAMES.get(use.template, use.template),
            "done": "картинка с фоном" if use.channel == "story" else _DONE.get(use.action, use.action),
            "ink": _INK.get(use.ink, use.ink),
        })

    months = sorted(
        {(d.year, d.month) for (d,) in db.execute(select(StickerUse.day).distinct()).all()} | {(year, month)},
        reverse=True,
    )
    total = sum(r["total"] for r in table)
    people = db.execute(select(func.count(func.distinct(StickerUse.user_id))).where(*in_month)).scalar_one()
    return {
        "table": table,
        "total": total,
        "readers": people,
        # «7 стикеров от 1 читателя»
        "headline": f"{_ru(total, 'стикер', 'стикера', 'стикеров')} от {_ru(people, 'читателя', 'читателей', 'читателей')}",
        "inks": {"белый": inks.get("light", 0), "чёрный": inks.get("dark", 0)},
        "recent": recent,
        "months": [{"key": f"{y}-{m:02d}", "label": f"{MONTHS[m]} {y}", "current": (y, m) == (year, month)} for y, m in months],
        "month_label": f"{MONTHS[month]} {year}",
    }


class StickersView(BaseView):
    name = "Стикеры"
    identity = "stickers"
    icon = "fa-solid fa-note-sticky"

    @expose("/stickers", methods=["GET"])
    async def page(self, request: Request):
        today = datetime.now(tz=ROUND_TZ).date()
        year, month = today.year, today.month
        asked = request.query_params.get("m", "")
        try:
            y, m = (int(x) for x in asked.split("-"))
            if 1 <= m <= 12:
                year, month = y, m
        except ValueError:
            pass
        db = get_session_factory()()
        try:
            data = build(db, year, month)
        finally:
            db.close()
        context = {
            "title": "Стикеры",
            "subtitle": "Какие стикеры для сторис читатели берут чаще",
            "data": data,
            "base": str(request.url_for("admin:index")).rstrip("/"),
        }
        response = self.templates.TemplateResponse(request, "stickers.html", context)
        if inspect.isawaitable(response):
            response = await response
        return response
