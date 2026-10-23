"""When two books of the shared library are one, and who says so.

The founder (2026-10-23): «Монах, который продал Феррари» and «Монах который продал свой Феррари» stayed two books;
stop the library's silly mistakes. The council's verdict, built here:

  - nothing joins on looks alone. The key (app.core.booktitles) joins only what is the same text written another
    way: punctuation, quotes, Latin or Cyrillic Kazakh, a Latin «ə» for «ә»;
  - a likely double (admin_books.likely_doubles) goes to the founder once, in Telegram, «Одна книга» / «Разные»,
    a few a day. «Одна книга» makes a book link; «Разные» is kept (book_pairs) and the pair never comes back;
  - never one book, whoever asks — the founder's button, /admin or a reader's pin: two volumes of a series
    («Шантарам 1» and «Шантарам 2», «Абай жолы. I том» and «II том»; a title and its numbered volume too), and
    two different authors. A number that is the title («1984», «Метро 2033», «451 градус») is no volume.

Tests: tests/test_book_identity.py — the real pairs found in the library on 2026-10-23, both kinds.
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.booktitles import match_key
from app.models.book_pair import BookPair
from app.services import catalog

logger = logging.getLogger(__name__)

# Likely doubles asked in Telegram a day: a few, so it never turns into a chore.
ASK_PER_DAY = 3


def _roman(n: int | None) -> str:
    return "без номера" if n is None else str(n)


def _surnames(author: str) -> list[str]:
    return [k for k in (match_key(w) for w in re.findall(r"[^\W\d_]{4,}", author)) if len(k) >= 4]


def same_person(a: str, b: str) -> bool:
    """«Джон Р. Р. Толкин» and «Толкин», «J. K. Rowling» and «Джоан Роулинг»: a name in common, spelled near enough."""
    wa, wb = _surnames(a), _surnames(b)
    if not wa or not wb:
        return True
    return any(x == y or SequenceMatcher(None, x, y).ratio() >= 0.75 for x in wa for y in wb)


def why_apart(title_a: str, author_a: str | None, title_b: str, author_b: str | None) -> str | None:
    """Why these two are never one book, in the founder's words; None when nothing says so."""
    from app.services.book_import import volume

    va, vb = volume(title_a)[1], volume(title_b)[1]
    if va != vb:
        return f"разные тома ({_roman(va)} и {_roman(vb)})"
    if author_a and author_b and not same_person(author_a, author_b):
        return f"разные авторы ({author_a} и {author_b})"
    return None


def _pair_key(a: str, b: str) -> tuple[str, str]:
    return tuple(sorted((a, b)))  # type: ignore[return-value]


def decided(db: Session) -> dict[tuple[str, str], str]:
    """Every pair already asked or answered, by both books' keys, and how it stands."""
    return {_pair_key(r.key_a, r.key_b): r.status for r in db.execute(select(BookPair)).scalars()}


def candidates(db: Session, idx: catalog.CatalogIndex | None = None) -> list[tuple[dict, dict]]:
    """Likely doubles nobody has answered for, and that nothing forbids: what the founder may be asked about."""
    from app.admin_books import _votes, likely_doubles

    idx = idx or catalog.index(db)
    done = decided(db)
    out = []
    for a, b in likely_doubles(idx, _votes(db, idx)):
        if _pair_key(a["key"], b["key"]) in done:
            continue
        if why_apart(a["title"], a["author"] or None, b["title"], b["author"] or None):
            continue
        out.append((a, b))
    return out


def decide(db: Session, pair_id: uuid.UUID, same: bool, admin_id: uuid.UUID | None = None) -> str:
    """The founder's «Одна книга» / «Разные». Returns what to write under the message."""
    from app.admin_books import link

    row = db.get(BookPair, pair_id)
    if row is None:
        return "Пары уже нет"
    if row.status != "asked":
        return "Уже решено: " + ("одна книга" if row.status == "same" else "разные")
    if same:
        try:
            made = link(db, [row.key_a, row.key_b], admin_id)
        except ValueError as exc:
            return f"⚠️ Не склеено: {exc}"
        if not made:
            # one of them is gone from the library, or they are one already
            row.status = "same"
            db.commit()
            return "Уже одна книга"
    row.status = "same" if same else "apart"
    row.decided_by = admin_id
    db.commit()
    return "✅ Одна книга — склеено" if same else "❌ Разные — больше не спросим"


def mark_apart(db: Session, key_a: str, key_b: str, admin_id: uuid.UUID | None = None) -> bool:
    """«Разные» from /admin: the pair stays apart and leaves the list of likely doubles."""
    idx = catalog.index(db)
    a, b = idx.find(key_a), idx.find(key_b)
    if a is None or b is None or a.key == b.key:
        return False
    ka, kb = _pair_key(a.key, b.key)
    titles = {a.key: a.title, b.key: b.title}
    row = db.execute(select(BookPair).where(BookPair.key_a == ka, BookPair.key_b == kb)).scalar_one_or_none()
    if row is None:
        row = BookPair(key_a=ka, key_b=kb, title_a=titles[ka][:300], title_b=titles[kb][:300])
        db.add(row)
    row.status, row.decided_by = "apart", admin_id
    db.commit()
    return True


def ask_founder(db: Session, limit: int = ASK_PER_DAY) -> int:
    """The daily few: new likely doubles to the founder's Telegram with two buttons. Returns how many were asked."""
    from app.services import admin_ping

    if not admin_ping.chat_ids():
        return 0
    # once a day: the other worker's tick, or a restart, does not ask the next few
    since = datetime.now(timezone.utc) - timedelta(hours=20)
    if db.execute(select(BookPair.id).where(BookPair.created_at >= since).limit(1)).first() is not None:
        return 0
    asked = 0
    for a, b in candidates(db)[:limit]:
        ka, kb = _pair_key(a["key"], b["key"])
        by_key = {a["key"]: a, b["key"]: b}
        row = BookPair(key_a=ka, key_b=kb, title_a=by_key[ka]["title"][:300], title_b=by_key[kb]["title"][:300])
        db.add(row)
        db.commit()
        admin_ping.book_pair_waiting(pair_id=str(row.id), a=by_key[ka], b=by_key[kb])
        asked += 1
    return asked


def scheduled() -> None:
    """The scheduler's daily tick: one worker at a time (both start a scheduler), so the founder is asked once; an
    error never reaches the scheduler."""
    import fcntl
    from pathlib import Path

    from app.core.config import settings
    from app.db.session import get_session_factory

    lock = Path(settings.library_storage_dir).parent / ".book-pairs.lock"
    try:
        lock.parent.mkdir(parents=True, exist_ok=True)
        handle = open(lock, "w")
    except OSError:
        return
    with handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            return
        db = get_session_factory()()
        try:
            asked = ask_founder(db)
            if asked:
                logger.info("likely doubles asked in Telegram: %d", asked)
        except Exception:
            logger.exception("likely doubles: asking failed")
            db.rollback()
        finally:
            db.close()
            fcntl.flock(handle, fcntl.LOCK_UN)
