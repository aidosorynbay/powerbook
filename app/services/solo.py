"""Reading outside the circle: a dial and a calendar of one's own.

The founder (2026-10-20): a reader who is not in this month's circle still reads — in the reading room, or on their
own — and the minutes should not be lost: they go to the book on the reader's shelf, and into a month of their own
that runs alongside the circle's and looks like the Round's panel. A day belongs to the circle when the reader takes
part in that month's circle and the circle covers the day; every other day is the reader's own (solo_days).

Solo days are kept apart from reading_logs: the leaderboard, the streaks and the awards are the circle's.
"""
from __future__ import annotations

import calendar
import uuid
from datetime import date, timedelta

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.constants import DEFAULT_GROUP_SLUG
from app.models.enums import RoundParticipantStatus
from app.models.round import Round, RoundParticipant
from app.models.solo import SoloDay, SoloDayBook
from app.repositories.insights import normalize_book_title

# How far back a reader may still fill in a day they forgot.
EDITABLE_DAYS = 40
MAX_DAY = 24 * 60
# «Что читаю» offers books given minutes this lately.
RECENT_DAYS = 60
RECENT_BOOKS = 8
IN_CIRCLE = {RoundParticipantStatus.active, RoundParticipantStatus.locked}


def _norm(title: str) -> str:
    return normalize_book_title(title) or title.casefold()


def _clean(title: str | None) -> str:
    return " ".join((title or "").split())[:300]


def today() -> date:
    # the room's reading day: it turns at 03:00, so reading after midnight is still last night's
    from app.services.reading_room import reading_day

    return reading_day()


class SoloService:
    def __init__(self, db: Session) -> None:
        self.db = db

    # ---------- whose day is it ----------

    def _rounds(self, days: list[date]) -> dict[tuple[int, int], Round]:
        from app.services.groups import GroupService

        group = GroupService(self.db).get_by_slug(slug=DEFAULT_GROUP_SLUG)
        months = {(d.year, d.month) for d in days}
        out = {}
        for y, m in months:
            rnd = self.db.execute(
                select(Round).where(Round.group_id == group.id, Round.year == y, Round.month == m)
            ).scalars().first()
            if rnd is not None:
                out[(y, m)] = rnd
        return out

    def circle_days(self, user_id: uuid.UUID, days: list[date]) -> set[date]:
        """Which of these days belong to the reader's circle: they take part in that month's circle and it covers the
        day. Those days are logged in the circle; the rest are the reader's own."""
        rounds = self._rounds(days)
        if not rounds:
            return set()
        taking = set(self.db.execute(
            select(RoundParticipant.round_id).where(
                RoundParticipant.user_id == user_id,
                RoundParticipant.round_id.in_([r.id for r in rounds.values()]),
                RoundParticipant.status.in_(IN_CIRCLE),
            )
        ).scalars())
        out = set()
        for d in days:
            rnd = rounds.get((d.year, d.month))
            if rnd is not None and rnd.id in taking and rnd.covers(d):
                out.add(d)
        return out

    def is_solo_day(self, user_id: uuid.UUID, day: date) -> bool:
        return day not in self.circle_days(user_id, [day])

    def _editable(self, user_id: uuid.UUID, day: date) -> None:
        now = today()
        if day > now:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Day is in the future")
        if day < now - timedelta(days=EDITABLE_DAYS):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Day is too old")
        if not self.is_solo_day(user_id, day):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Day belongs to the circle")

    # ---------- the days ----------

    def _day(self, user_id: uuid.UUID, day: date) -> SoloDay | None:
        return self.db.execute(
            select(SoloDay).where(SoloDay.user_id == user_id, SoloDay.date == day)
        ).scalars().first()

    def _write(self, user_id: uuid.UUID, day: date, minutes: int, books: list[tuple[str, int]] | None) -> SoloDay | None:
        """The day as it should now stand. `books`: (title, minutes) in order, or None to keep the day's books (a
        single book follows the day's total). A day with nothing left on it goes."""
        row = self._day(user_id, day)
        if books is not None:
            folded: dict[str, list] = {}
            for title, m in books:
                title = _clean(title)
                if not title:
                    continue
                n = _norm(title)
                if n in folded:
                    folded[n][1] += max(0, m)
                else:
                    folded[n] = [title, max(0, m)]
            books = [(t, m) for t, m in folded.values()]
            if len(books) == 1 and books[0][1] == 0:
                books = [(books[0][0], minutes)]
            minutes = max(minutes, sum(m for _, m in books))
        minutes = max(0, min(MAX_DAY, minutes))
        if minutes == 0 and not books:
            if row is not None:
                self.db.delete(row)
                self.db.flush()
            return None
        if row is None:
            row = SoloDay(user_id=user_id, date=day, minutes=minutes)
            self.db.add(row)
            self.db.flush()
        row.minutes = minutes
        if books is not None:
            row.books.clear()
            self.db.flush()
            for i, (title, m) in enumerate(books):
                row.books.append(SoloDayBook(user_id=user_id, title=title, title_norm=_norm(title), minutes=m, position=i))
        elif len(row.books) == 1:
            row.books[0].minutes = minutes
        self.db.flush()
        return row

    def minutes_on(self, user_id: uuid.UUID, day: date) -> int:
        row = self._day(user_id, day)
        return int(row.minutes) if row is not None else 0

    def set_day(self, *, user_id: uuid.UUID, day: date, minutes: int, books: list[tuple[str, int]] | None) -> dict:
        """The dial's «Сохранить»: the day's total and what it was read on, as the reader set them."""
        self._editable(user_id, day)
        row = self._write(user_id, day, minutes, books)
        self.db.commit()
        return self._day_out(day, row, circle=False)

    def add(self, *, user_id: uuid.UUID, day: date, minutes: int, title: str | None) -> SoloDay | None:
        """Minutes read in the reading room, added to the day and to the book sat down with; what the reader set for
        the day stays. Not committed: the caller closes its sitting in the same go."""
        row = self._day(user_id, day)
        books = [(b.title, int(b.minutes)) for b in row.books] if row is not None else []
        title = _clean(title)
        if title:
            n = _norm(title)
            for i, (t, m) in enumerate(books):
                if _norm(t) == n:
                    books[i] = (t, m + minutes)
                    break
            else:
                books.append((title, minutes))
        total = (int(row.minutes) if row is not None else 0) + minutes
        return self._write(user_id, day, total, books if title else None)

    def take_back(self, *, user_id: uuid.UUID, day: date, minutes: int, title: str | None) -> None:
        """The reading room's «Отменить»: the sitting's minutes off the day and off its book."""
        row = self._day(user_id, day)
        if row is None:
            return
        books = [(b.title, int(b.minutes)) for b in row.books]
        title = _clean(title)
        if title:
            n = _norm(title)
            books = [(t, max(0, m - minutes) if _norm(t) == n else m) for t, m in books]
            books = [(t, m) for t, m in books if m > 0]
        self._write(user_id, day, max(0, int(row.minutes) - minutes), books if row.books else None)

    # ---------- the month, for the panel ----------

    @staticmethod
    def _day_out(d: date, row: SoloDay | None, *, circle: bool) -> dict:
        return {
            "date": d.isoformat(),
            "minutes": int(row.minutes) if row is not None else 0,
            "books": [{"title": b.title, "minutes": int(b.minutes)} for b in row.books] if row is not None else [],
            # the reader was in the circle that day: its minutes are in the circle's calendar, not here
            "circle": circle,
        }

    def month(self, *, user_id: uuid.UUID, year: int | None = None, month: int | None = None) -> dict:
        now = today()
        year, month = year or now.year, month or now.month
        if not 1 <= month <= 12 or not 2020 <= year <= now.year + 1:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No such month")
        days = [date(year, month, n) for n in range(1, calendar.monthrange(year, month)[1] + 1)]
        rows = {
            r.date: r for r in self.db.execute(
                select(SoloDay).where(SoloDay.user_id == user_id, SoloDay.date >= days[0], SoloDay.date <= days[-1])
            ).scalars()
        }
        circle = self.circle_days(user_id, days + ([now] if now not in days else []))
        out = [self._day_out(d, rows.get(d), circle=d in circle) for d in days]
        total = sum(int(r.minutes) for r in rows.values())
        return {
            "year": year, "month": month, "today": now.isoformat(),
            "editable_from": (now - timedelta(days=EDITABLE_DAYS)).isoformat(),
            # today is the circle's: the panel says so instead of offering the dial
            "today_in_circle": now in circle,
            "total_minutes": total,
            "days_read": sum(1 for r in rows.values() if int(r.minutes) > 0),
            "goal_days": sum(1 for r in rows.values() if int(r.minutes) >= 30),
            "streak": self.streak(user_id),
            "days": out,
            "books": self.recent_books(user_id),
        }

    def streak(self, user_id: uuid.UUID) -> int:
        """Days in a row with some reading, up to today (or yesterday, while today is still open)."""
        now = today()
        read = set(self.db.execute(
            select(SoloDay.date).where(SoloDay.user_id == user_id, SoloDay.minutes > 0, SoloDay.date >= now - timedelta(days=400))
        ).scalars())
        d = now if now in read else now - timedelta(days=1)
        n = 0
        while d in read:
            n += 1
            d -= timedelta(days=1)
        return n

    def recent_books(self, user_id: uuid.UUID) -> list[dict]:
        """Books to put today's minutes on: the ones the reader gave time to lately and has not finished, wherever
        (the circle, the room, the dial), with the minutes already on each."""
        from app.repositories.claims import ClaimsRepository
        from app.services import book_time

        ids = list(ClaimsRepository(self.db).effective_user_ids(user_id=user_id))
        since = today() - timedelta(days=RECENT_DAYS)
        books = [b for b in book_time.of_readers(self.db, ids).values() if not b.finished and b.last_day and b.last_day >= since]
        books.sort(key=lambda b: b.last_day, reverse=True)
        return [{"title": b.title, "minutes": b.minutes} for b in books[:RECENT_BOOKS]]
