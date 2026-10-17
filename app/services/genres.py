"""What a reader reads, by genre, in minutes.

The library already knows what each book is about (`BookFact.topics`, the keys
of `app.services.topics`) and the reader's minutes already sit on books
(`book_time`). This ties the two: every minute a reader gave a book goes to
that book's main topic (the first one, the strongest), so a day is counted
once and the shares add up to the whole. It is the reader's personal genre
statistics and the ground of the «Жанры» awards.

A book the library has no topics for yet counts to no genre: the facts are
filled in the background, and the figures catch up.
"""
from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.round import ReadingLog, ReadingLogBook
from app.services import book_time, catalog
from app.services import books as books_service


@dataclass
class GenreStat:
    topic: str
    minutes: int = 0
    books: int = 0
    share: int = 0  # percent of the minutes that went to a known genre


def topic_lookup(db: Session) -> Callable[[str], str | None]:
    """title → the book's main topic, or None when the library does not know one."""
    idx = catalog.index(db)
    facts = books_service.facts_by_work(db, idx)
    memo: dict[str, str | None] = {}

    def of(title: str) -> str | None:
        if title not in memo:
            fact = facts.get(book_time.book_of(idx, title))
            memo[title] = (fact.topics or [None])[0] if fact and fact.topics else None
        return memo[title]

    return of


def minutes_by_day(db: Session, topic_of: Callable[[str], str | None], ids: list[uuid.UUID] | None = None) -> dict[uuid.UUID, dict[str, dict[date, int]]]:
    """user → genre → day → minutes, for the given accounts (everyone when None)."""
    stmt = (
        select(ReadingLogBook.user_id, ReadingLogBook.title, ReadingLog.date, ReadingLogBook.minutes)
        .join(ReadingLog, ReadingLog.id == ReadingLogBook.reading_log_id)
        .where(ReadingLogBook.minutes > 0)
    )
    if ids is not None:
        stmt = stmt.where(ReadingLogBook.user_id.in_(ids))
    out: dict[uuid.UUID, dict[str, dict[date, int]]] = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
    for uid, title, d, m in db.execute(stmt).all():
        topic = topic_of(title)
        if topic:
            out[uid][topic][d] += int(m)
    return out


def profile(db: Session, user_ids: list[uuid.UUID]) -> list[GenreStat]:
    """The reader's genres, most minutes first (archive nicknames folded in by the caller's ids)."""
    idx = catalog.index(db)
    facts = books_service.facts_by_work(db, idx)
    stats: dict[str, GenreStat] = {}
    for key, bt in book_time.of_readers(db, user_ids, idx).items():
        fact = facts.get(key)
        if not fact or not fact.topics:
            continue
        s = stats.setdefault(fact.topics[0], GenreStat(fact.topics[0]))
        s.minutes += bt.minutes
        s.books += 1
    total = sum(s.minutes for s in stats.values())
    for s in stats.values():
        s.share = round(100 * s.minutes / total) if total else 0
    return sorted(stats.values(), key=lambda s: -s.minutes)
