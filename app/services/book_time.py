"""The time a reader has given a book, wherever the book is named.

A book is named in many places: «Что читаю» on a day of the round, the
reading room's «Что читаете?», the title of a file in the reader, the shelf,
the library. Each spelling is free text, so the minutes are tied together
here, the way the shared library ties copies into one book: a title goes to
the library's book when the catalog knows it (its typos, corrected
spellings, pins and the founder's links), else to its own comparison key.

`of_readers` is a reader's books with the minutes and days on each, summed
over every spelling; `for_book` is one book's minutes for a reader and for
the whole circle.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.core.booktitles import canonical_key, matching_key
from app.models.round import ReadingLog, ReadingLogBook
from app.repositories.insights import normalize_book_title
from app.services import catalog, covers


def _title_norm(title: str) -> str:
    return normalize_book_title(title) or title.casefold()


def book_of(idx: catalog.CatalogIndex, title: str) -> str:
    """The key of the book a title names: the library's book, or the title's own key."""
    clean = covers.clean_title(title) or title
    nodes = [k for k in (matching_key(title), canonical_key(clean), catalog.work_key(title)) if k]
    for node in nodes:
        work = idx.find(node)
        if work is not None:
            return work.key
    return nodes[0] if nodes else f"n:{_title_norm(title)}"


@dataclass
class BookTime:
    key: str
    # The spelling the reader used most lately, or the library's title.
    title: str
    minutes: int = 0
    days: int = 0
    last_day: date | None = None
    finished: bool = False
    # every spelling the reader used for it
    titles: set[str] = field(default_factory=set)


def of_readers(db: Session, user_ids: list[uuid.UUID], idx: catalog.CatalogIndex | None = None) -> dict[str, BookTime]:
    """Every book these accounts (a reader and their claimed archive) gave minutes to, by book key."""
    if not user_ids:
        return {}
    idx = idx or catalog.index(db)
    rows = db.execute(
        select(
            ReadingLogBook.title_norm,
            func.max(ReadingLogBook.title),
            func.sum(ReadingLogBook.minutes),
            func.count(func.distinct(ReadingLog.date)),
            func.max(ReadingLog.date),
            # (Postgres has no max() of a boolean)
            func.max(case((ReadingLogBook.finished.is_(True), 1), else_=0)),
        )
        .join(ReadingLog, ReadingLog.id == ReadingLogBook.reading_log_id)
        .where(ReadingLogBook.user_id.in_(user_ids), ReadingLogBook.minutes > 0)
        .group_by(ReadingLogBook.title_norm)
    ).all()
    out: dict[str, BookTime] = {}
    for _norm, title, minutes, days, last_day, finished in rows:
        key = book_of(idx, title)
        work = idx.works.get(key)
        bt = out.get(key)
        if bt is None:
            bt = out[key] = BookTime(key=key, title=work.title if work else title)
        bt.titles.add(title)
        bt.minutes += int(minutes or 0)
        # (two spellings on one day count that day twice: rare enough to let be)
        bt.days += int(days or 0)
        bt.finished = bt.finished or bool(finished)
        if last_day and (bt.last_day is None or last_day > bt.last_day):
            bt.last_day = last_day
            if work is None:
                bt.title = title
    return out


def minutes_on(db: Session, user_ids: list[uuid.UUID], titles: list[str], idx: catalog.CatalogIndex | None = None) -> dict[str, int]:
    """Each title's book's total minutes for these accounts, by the title as given."""
    if not titles:
        return {}
    idx = idx or catalog.index(db)
    books = of_readers(db, user_ids, idx)
    return {t: (books[k].minutes if (k := book_of(idx, t)) in books else 0) for t in titles}


def for_book(db: Session, key: str, user_ids: list[uuid.UUID] | None = None) -> dict:
    """One library book's minutes: the reader's own, and the circle's (everyone who named it)."""
    idx = catalog.index(db)
    rows = db.execute(
        select(ReadingLogBook.user_id, func.max(ReadingLogBook.title), func.sum(ReadingLogBook.minutes))
        .where(ReadingLogBook.minutes > 0)
        .group_by(ReadingLogBook.user_id, ReadingLogBook.title_norm)
    ).all()
    mine = set(user_ids or [])
    total = own = 0
    people: set[uuid.UUID] = set()
    for user_id, title, minutes in rows:
        if book_of(idx, title) != key:
            continue
        total += int(minutes or 0)
        people.add(idx.person_of(user_id))
        if user_id in mine:
            own += int(minutes or 0)
    return {"minutes": own, "circle_minutes": total, "circle_readers": len(people)}


def of_sitters(db: Session, pairs: list[tuple[uuid.UUID, str]]) -> list[int]:
    """For each (reader, book title) — the reading room's sitters — the minutes that reader has given that book
    before, in one query for the whole hall."""
    if not pairs:
        return []
    idx = catalog.index(db)
    rows = db.execute(
        select(ReadingLogBook.user_id, func.max(ReadingLogBook.title), func.sum(ReadingLogBook.minutes))
        .where(ReadingLogBook.user_id.in_({u for u, _ in pairs}), ReadingLogBook.minutes > 0)
        .group_by(ReadingLogBook.user_id, ReadingLogBook.title_norm)
    ).all()
    spent: dict[tuple[uuid.UUID, str], int] = {}
    for user_id, title, minutes in rows:
        k = (user_id, book_of(idx, title))
        spent[k] = spent.get(k, 0) + int(minutes or 0)
    return [spent.get((u, book_of(idx, t)), 0) for u, t in pairs]
