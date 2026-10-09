"""«Книга прочитана»: which book it is, and how long it took in PowerBook.

Which book. The title a reader types when they finish a book is looked up
before anything is saved, on their own shelf and in the shared library,
by the same comparison keys the shelf and the library group books by.
Found, it is that book and nothing new appears. Not found but close (the
author written into the title, a letter missed), the page asks «Это она?»
and, if so, the finish is saved under the title the reader's shelf
already has for it, or the library's for a book new to their shelf, so
the book does not stand there twice.

How long. The days a reader named the book in «Что читаю» are its time.
Many days have no book named, so on finishing it the reader says from
which day they read it: every day since then with minutes and no book
named is given to it (`filled`). The day offered is the one after the
previous book they finished, or the round's first day; never further
back than the last time they finished this same book.

Two books at once. A day with no book named, while another book was open
(named before that day and again after it, not finished in between), is
shared equally between them; so is a day another finished book was given
already. Each book's share is its time.

The reader's word. Afterwards, on the shelf or from the day it was
finished, the reader can go through the days one by one and say which
were this book's and how many minutes: those are named rows from then on.
"""
from __future__ import annotations

import difflib
import uuid
from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.booktitles import match_key, matching_key
from app.models.manual_book import ManualBook
from app.models.round import ReadingLog, ReadingLogBook
from app.models.user import User
from app.repositories.claims import ClaimsRepository
from app.repositories.insights import normalize_book_title
from app.services import catalog
from app.services.catalog import Work

# How far back a period can reach.
REACH_DAYS = 365
# Days after the finish still say whether another book was open on a day before it.
AFTER_DAYS = 92
# How many days before the finish the day-by-day list goes back.
EDIT_DAYS = 120
# A key this close to a book's is that book with a typo («Шантарм»).
TYPO_RATIO = 0.84
CHOICES = 3


def _norm(title: str) -> str:
    return normalize_book_title(title) or title.casefold()


def _key(title: str) -> str | None:
    return matching_key(title) or catalog.work_key(title)


# ---------- which book ----------


def _typos(idx: catalog.CatalogIndex, title: str) -> list[Work]:
    key = match_key(title)
    if len(key) < 5:
        return []
    scored: list[tuple[float, Work]] = []
    for work in idx.works.values():
        best = 0.0
        for member in work.members:
            if abs(len(member) - len(key)) > 3:
                continue
            m = difflib.SequenceMatcher(None, key, member)
            if m.quick_ratio() >= TYPO_RATIO:
                best = max(best, m.ratio())
        if best >= TYPO_RATIO:
            scored.append((best, work))
    scored.sort(key=lambda x: (-x[0], -len(x[1].readers)))
    return [w for _r, w in scored[:CHOICES]]


def _shelf_title(db: Session, work: Work, accounts: list[uuid.UUID]) -> str | None:
    """The book's title as it already stands on the reader's shelf."""
    from app.services.bookcase import _short_hash, _split_comment

    for account in accounts:
        volume = work.holders.get(account)
        if not volume:
            continue
        if volume.startswith("m:"):
            book = db.get(ManualBook, uuid.UUID(volume[2:]))
            if book is not None:
                return book.title
        elif volume.startswith("r:"):
            comments = db.execute(
                select(ReadingLog.comment).where(
                    ReadingLog.user_id == account, ReadingLog.book_finished.is_(True), ReadingLog.comment.is_not(None)
                )
            ).scalars()
            for comment in comments:
                if f"r:{_short_hash(normalize_book_title(comment))}" == volume:
                    return _split_comment(comment)[0]
    return None


def which_book(db: Session, *, user: User, title: str) -> dict:
    """The book of the shelf or the shared library this title is (exact), or
    the few it could be."""
    from app.services import books

    idx = catalog.index(db)
    accounts = list(ClaimsRepository(db).effective_user_ids(user_id=user.id))
    people = {idx.person_of(a) for a in accounts}
    found = idx.find(_key(title))
    if found is not None:
        works = [found]
    else:
        works = [idx.works[i.key] for i in books.match_works(db, viewer_id=user.id, query=title, limit=CHOICES) if i.key in idx.works]
        works = works or _typos(idx, title)
    choices = []
    for item in books.items_for(db, viewer_id=user.id, works=works):
        work = idx.works[item.key]
        mine = bool(work.readers & people)
        choices.append({
            "key": work.key,
            "title": (_shelf_title(db, work, accounts) if mine else None) or work.title,
            "author": work.author,
            "cover_thumb_url": item.cover_thumb_url,
            "readers": item.readers,
            "on_shelf": mine,
        })
    return {"exact": found is not None and bool(choices), "choices": choices}


# ---------- how long ----------


def _split(minutes: int, n: int) -> list[int]:
    """Minutes shared equally; what does not divide goes to the first."""
    base, rest = divmod(max(0, minutes), n)
    return [base + (1 if i < rest else 0) for i in range(n)]


class _Period:
    """The reader's days around one finish of one book."""

    def __init__(self, db: Session, *, user_id: uuid.UUID, title: str, day: date) -> None:
        self.user_id, self.title, self.day = user_id, title, day
        self.norm, self.key = _norm(title), _key(title)
        self.logs: list[ReadingLog] = list(
            db.execute(
                select(ReadingLog)
                .options(selectinload(ReadingLog.books))
                .where(
                    ReadingLog.user_id == user_id,
                    ReadingLog.date <= day + timedelta(days=AFTER_DAYS),
                    ReadingLog.date >= day - timedelta(days=REACH_DAYS),
                )
                .order_by(ReadingLog.date.desc())
            ).scalars()
        )
        # The other books named on these days: when, and whether finished that day.
        self.mentions: dict[str, list[tuple[date, bool]]] = defaultdict(list)
        self.titles: dict[str, str] = {}
        for log in self.logs:
            for b in log.books:
                if not self.is_mine(b):
                    self.titles.setdefault(b.title_norm, b.title)
                    if not b.filled:
                        self.mentions[b.title_norm].append((log.date, b.finished))

        self.floor = day - timedelta(days=REACH_DAYS)
        first_named = earliest = other_finish = None
        finished_here = False
        for log in self.logs:
            if log.date > day:
                continue
            if log.date == day:
                finished_here = finished_here or self._finishes(log)
                continue
            if self._finishes(log):
                # Read before: this time starts after that one.
                self.floor = log.date + timedelta(days=1)
                break
            mine = self.mine(log)
            if mine:
                earliest = log.date
                if not all(b.filled for b in mine):
                    first_named = log.date
            if other_finish is None and log.book_finished:
                other_finish = log.date
        self.first_named = first_named
        if finished_here and earliest is not None:
            # Saved again: the period the reader chose then.
            suggested = earliest
        else:
            suggested = other_finish + timedelta(days=1) if other_finish else day.replace(day=1)
            if first_named is not None and first_named < suggested:
                suggested = first_named
        self.suggested = self.clamp(suggested)

    def _same(self, title: str) -> bool:
        return _norm(title) == self.norm or (self.key is not None and _key(title) == self.key)

    def is_mine(self, b: ReadingLogBook) -> bool:
        return b.title_norm == self.norm or self._same(b.title)

    def mine(self, log: ReadingLog) -> list[ReadingLogBook]:
        return [b for b in log.books if self.is_mine(b)]

    def _finishes(self, log: ReadingLog) -> bool:
        if any(b.finished for b in self.mine(log)):
            return True
        return bool(log.book_finished and log.comment and not log.books and self._same(log.comment))

    def clamp(self, start: date | None) -> date:
        start = start or self.suggested
        start = min(max(start, self.floor), self.day)
        # A day the reader named the book is its day, whatever the period says.
        if self.first_named is not None and start > self.first_named:
            start = self.first_named
        return start

    def _open(self, on: date) -> list[str]:
        """Other books open that day: named before it, not finished since, named again after."""
        out = []
        for norm, mentions in self.mentions.items():
            before = [m for m in mentions if m[0] < on]
            if not before or max(before)[1] or not any(m[0] > on for m in mentions):
                continue
            out.append(norm)
        return out

    def sharers(self, log: ReadingLog) -> list[str]:
        """The books a day with no book named goes to: this one first."""
        others = {b.title_norm for b in log.books if b.filled and not self.is_mine(b)} | set(self._open(log.date))
        others.discard(self.norm)
        return [self.norm, *sorted(others)]

    def share(self, log: ReadingLog) -> int:
        """This book's minutes of a day before the finish."""
        mine = self.mine(log)
        if any(not b.filled for b in log.books):
            # A day the reader named books on: theirs to say.
            return sum(int(b.minutes) for b in mine)
        if log.minutes <= 0:
            return 0
        return _split(int(log.minutes), len(self.sharers(log)))[0]

    def count(self, start: date, minutes_today: int) -> dict:
        minutes, days, filled = minutes_today, int(minutes_today > 0), 0
        shared: set[str] = set()
        for log in self.logs:
            if not (start <= log.date < self.day):
                continue
            got = self.share(log)
            if got <= 0:
                continue
            minutes += got
            days += 1
            if not any(not b.filled for b in log.books):
                filled += 1
                shared.update(self.titles.get(n, n) for n in self.sharers(log)[1:])
        return {"minutes": minutes, "days": days, "filled_days": filled, "shared_with": sorted(shared)}

    def resplit(self, log: ReadingLog, norms: list[str], minutes: int) -> None:
        """A day's filled rows shared equally among these books (this one, if
        among them, gets a row); filled rows of books not among them go."""
        shares = dict(zip(norms, _split(minutes, len(norms)))) if norms else {}
        for b in [b for b in log.books if b.filled]:
            norm = self.norm if self.is_mine(b) else b.title_norm
            if shares.get(norm, 0) > 0:
                b.minutes = shares.pop(norm)
            else:
                shares.pop(norm, None)
                log.books.remove(b)
        if shares.get(self.norm, 0) > 0:
            log.books.append(ReadingLogBook(
                user_id=self.user_id, title=self.title, title_norm=self.norm, minutes=shares[self.norm],
                finished=log.date == self.day, position=len(log.books), filled=True,
            ))


def how_long(db: Session, *, user: User, title: str, day: date, start: date | None, minutes_today: int) -> dict:
    """What the finish would count: from which day, and the minutes and days
    the book would have, the finish day's own minutes included."""
    period = _Period(db, user_id=user.id, title=title, day=day)
    start = period.clamp(start)
    return {
        "start": start,
        "suggested": period.suggested,
        "earliest": period.floor,
        **period.count(start, minutes_today),
    }


def give_days(db: Session, *, user_id: uuid.UUID, title: str, day: date, start: date | None) -> None:
    """The book finished on `day` was read since `start`: days with no book
    named get their share of it; days it was given before that start are
    taken back."""
    period = _Period(db, user_id=user_id, title=title, day=day)
    start = period.clamp(start)
    for log in period.logs:
        if log.date < period.floor or log.date > day:
            continue
        if any(not b.filled for b in log.books):
            continue
        if log.date == day:
            # Finished with no book named that day (the title in the comment only): the day is its.
            period.resplit(log, [period.norm], int(log.minutes))
        elif log.date >= start:
            period.resplit(log, period.sharers(log), int(log.minutes))
        elif period.mine(log):
            period.resplit(log, period.sharers(log)[1:], int(log.minutes))
    db.commit()


# ---------- day by day ----------


def finish_of(db: Session, *, user: User, volume_key: str) -> tuple[str, date]:
    """A book of the reader's shelf: its title as the days name it, and the
    day it was last finished. The shelf may show a title the reader fixed
    since; the days keep the one they were logged under."""
    from fastapi import HTTPException, status

    from app.services.bookcase import _short_hash, _split_comment

    if volume_key.startswith("r:"):
        logs = db.execute(
            select(ReadingLog.comment, ReadingLog.date)
            .where(ReadingLog.user_id == user.id, ReadingLog.book_finished.is_(True), ReadingLog.comment.is_not(None))
            .order_by(ReadingLog.date.desc())
        ).all()
        for comment, day in logs:
            if f"r:{_short_hash(normalize_book_title(comment))}" == volume_key:
                return _split_comment(comment)[0], day
    elif volume_key.startswith("m:"):
        try:
            book = db.get(ManualBook, uuid.UUID(volume_key[2:]))
        except ValueError:
            book = None
        if book is not None and book.user_id == user.id and book.finished_on is not None:
            return book.title, book.finished_on
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no_finish")


def days_of(db: Session, *, user: User, title: str, day: date) -> dict:
    """The reader's days before a finish, and what each gave this book."""
    period = _Period(db, user_id=user.id, title=title, day=day)
    first = max(period.floor, day - timedelta(days=EDIT_DAYS))
    days = []
    for log in period.logs:
        if log.date > day or log.date < first or log.minutes <= 0:
            continue
        mine = period.mine(log)
        others = [b for b in log.books if not period.is_mine(b)]
        room = max(0, int(log.minutes) - sum(int(b.minutes) for b in others if not b.filled))
        days.append({
            "date": log.date,
            "total": int(log.minutes),
            "minutes": sum(int(b.minutes) for b in mine),
            # What a tick gives it: the room left by named books, shared with the filled ones.
            "offer": sum(int(b.minutes) for b in mine) or room // (1 + sum(1 for b in others if b.filled)),
            "finish": log.date == day,
            "others": [{"title": b.title, "minutes": int(b.minutes)} for b in others],
        })
    total = sum(d["minutes"] for d in days)
    return {"title": title, "day": day, "earliest": first, "days": days,
            "minutes": total, "days_read": sum(1 for d in days if d["minutes"] > 0)}


def set_days(db: Session, *, user: User, title: str, day: date, minutes: dict[date, int]) -> dict:
    """The reader's own word on which days were this book's, and how long."""
    period = _Period(db, user_id=user.id, title=title, day=day)
    first = max(period.floor, day - timedelta(days=EDIT_DAYS))
    for log in period.logs:
        if log.date > day or log.date < first:
            continue
        mine = period.mine(log)
        others = [b for b in log.books if not period.is_mine(b)]
        named = sum(int(b.minutes) for b in others if not b.filled)
        want = max(0, minutes.get(log.date, 0))
        if log.date == day and want == 0:
            # The day it was finished stays its day.
            want = sum(int(b.minutes) for b in mine) or int(log.minutes) - named
        want = min(want, max(0, int(log.minutes) - named))
        for b in mine[1:]:
            log.books.remove(b)
        if want > 0:
            if mine:
                mine[0].minutes, mine[0].filled = want, False
            else:
                log.books.append(ReadingLogBook(
                    user_id=user.id, title=title, title_norm=period.norm, minutes=want,
                    finished=log.date == day, position=len(log.books), filled=False,
                ))
        elif mine:
            log.books.remove(mine[0])
        # What is left of the day goes to the books given it before, equally.
        filled = sorted({b.title_norm for b in others if b.filled})
        rest = int(log.minutes) - named - want
        shares = dict(zip(filled, _split(rest, len(filled)))) if filled else {}
        for b in [b for b in others if b.filled]:
            if shares.get(b.title_norm, 0) > 0:
                b.minutes = shares.pop(b.title_norm)
            else:
                log.books.remove(b)
    db.commit()
    return days_of(db, user=user, title=title, day=day)
