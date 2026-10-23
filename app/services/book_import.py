"""«Вставить список»: a reader pastes the books they have read, as text, and the ones missing from their shelf go on it.

The founder (2026-10-23): everyone has a list somewhere — a note on the phone, a Telegram message, a Goodreads export —
and typing it in one book at a time is what stops them. The list is read line by line, each line is matched to the
shared library where it can be (so «три товарища» is «Три товарища» by Ремарк), and the reader sees what will be added
and what is already on the shelf before anything is written. A photo of a list (later) only has to become this text.
"""
from __future__ import annotations

import re
import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.manual_book import ManualBook
from app.models.want_book import WantBook
from app.repositories.insights import normalize_book_title
from app.services import book_face, catalog

MAX_BOOKS = 300
MAX_TEXT = 30_000

# «1.», «12)», «- », «• », «✓ », «[x] » before a title
_LEAD = re.compile(r"^\s*(?:\[[ xх✓]?\]\s*|\d{1,4}\s*[.)\]:]\s*|[-–—•*·▪►>✓✔☑+]+\s*)+", re.IGNORECASE)
# a year, a date, a rating or a mark at the end: «(2024)», «— 5/5», «★★★★», «10/10»
_TAIL = re.compile(r"\s*(?:[-–—,:]\s*)?(?:\(\s*\d{4}\s*\)|\d{1,2}\s*/\s*\d{1,2}|[★☆⭐]+|\d{1,2}\.\d{1,2}\.\d{2,4})\s*$")
# between a title and its author
_DASH = re.compile(r"\s+[-–—]\s+")
_QUOTED = re.compile(r"[«\"“„]([^»\"”“]+)[»\"”“]")
_PAREN = re.compile(r"^(.+?)\s*\(([^()]+)\)\s*$")


@dataclass
class Item:
    n: int
    line: str
    title: str
    author: str | None
    # "add": not on the shelf, will go on it | "have": already there | "dup": the same book earlier in the list
    status: str
    # the shared library knows it: the title and the author are the library's
    known: bool
    # a copy the reader took off the shelf («Убрать с полки»): adding it puts that copy back
    hidden_key: str | None = None


def _lines(text: str) -> list[str]:
    parts = re.split(r"[\n\r;]+", text[:MAX_TEXT])
    out = []
    for raw in parts:
        line = _TAIL.sub("", _LEAD.sub("", raw)).strip(" \t.,·")
        # a heading («Прочитано в 2025:», «Октябрь»), a bare number or a stray mark is no book
        if not line or line.endswith(":") or not re.search(r"[^\W\d_]{2,}", line):
            continue
        out.append(line[:300])
    return out


def _split(idx: catalog.CatalogIndex, line: str) -> tuple[str, str | None, catalog.Work | None]:
    """The title and the author in a line, whichever way round they were written: the side the library knows as a
    book is the title. Unknown to the library, «Название — Автор» is taken as written."""
    whole = book_face.work_of(idx, title=line)
    if whole is not None:
        # «Маленький принц (Экзюпери)» is found whole (the library reads past the brackets): the author is kept
        m = _PAREN.match(line)
        halves = _DASH.split(line, maxsplit=1)
        for title, author in ([(m.group(1), m.group(2))] if m else []) + ([tuple(halves)] if len(halves) == 2 else []):
            if book_face.work_of(idx, title=title.strip()) is whole:
                return title.strip(), author.strip() or None, whole
        return line, None, whole
    quoted = _QUOTED.search(line)
    if quoted:
        title = quoted.group(1).strip()
        rest = (line[: quoted.start()] + " " + line[quoted.end():]).strip(" ,.-–—:")
        return title, rest or None, book_face.work_of(idx, title=title)
    pairs = []
    m = _PAREN.match(line)
    if m:
        pairs.append((m.group(1).strip(), m.group(2).strip()))
    halves = _DASH.split(line, maxsplit=1)
    if len(halves) == 2:
        pairs.append((halves[0].strip(), halves[1].strip()))
    if ", " in line and not pairs:
        a, b = line.split(", ", 1)
        # «Ремарк, Три товарища»: only when the library confirms which side is the book
        for title, author in ((b, a), (a, b)):
            work = book_face.work_of(idx, title=title)
            if work is not None:
                return title, author, work
    for a, b in pairs:
        for title, author in ((a, b), (b, a)):
            work = book_face.work_of(idx, title=title)
            if work is not None:
                return title, author, work
    if pairs:
        return pairs[0][0], pairs[0][1] or None, None
    return line, None, None


def plan(db: Session, user_id: uuid.UUID, text: str) -> list[Item]:
    from app.services.bookcase import BookcaseService

    idx = catalog.index(db)
    shelf = BookcaseService(db).bookcase(owner_id=user_id, viewer_id=user_id).books
    on_shelf_works, on_shelf_norms = set(), set()
    hidden_works: dict[str, str] = {}
    hidden_norms: dict[str, str] = {}
    for b in shelf:
        norms = {normalize_book_title(t) for t in [b.title, *(b.read_as or [])] if t}
        if b.hidden:
            if b.work_key:
                hidden_works.setdefault(b.work_key, b.key)
            for n in norms:
                hidden_norms.setdefault(n, b.key)
            continue
        if b.work_key:
            on_shelf_works.add(b.work_key)
        on_shelf_norms |= norms

    items: list[Item] = []
    seen: set[str] = set()
    for n, line in enumerate(_lines(text)[:MAX_BOOKS]):
        title, author, work = _split(idx, line)
        if work is not None:
            title = book_face.spelling(idx, title) or title
            author = author or work.author
        norm = normalize_book_title(title) or title.casefold()
        ident = work.key if work is not None else f"t:{norm}"
        if ident in seen or norm in seen:
            status = "dup"
        elif (work is not None and work.key in on_shelf_works) or norm in on_shelf_norms:
            status = "have"
        else:
            status = "add"
        seen |= {ident, norm}
        hidden = None
        if status == "add":
            hidden = (hidden_works.get(work.key) if work is not None else None) or hidden_norms.get(norm)
        items.append(Item(
            n=n, line=line, title=title[:300], author=(author or None) and author[:200], status=status,
            known=work is not None, hidden_key=hidden,
        ))
    return items


def apply(db: Session, user_id: uuid.UUID, text: str, skip: set[int] | None = None) -> tuple[list[Item], int]:
    """Puts the list's missing books on the shelf, but for the lines the reader unticked (`skip`). They are read now,
    so they leave «Хочу прочитать». Returns the plan and how many went on the shelf."""
    from app.models.book_review import BookReview
    from app.services import shelf_overrides, want

    skip = skip or set()
    items = plan(db, user_id, text)
    chosen = [i for i in items if i.status == "add" and i.n not in skip]
    if not chosen:
        return items, 0
    existing = {
        b.title_norm for b in db.execute(select(ManualBook).where(ManualBook.user_id == user_id)).scalars()
    }
    added: list[tuple[Item, str]] = []
    for item in chosen:
        if item.hidden_key:
            shelf_overrides.set_hidden(db, user_id, item.hidden_key, False)
            added.append((item, item.hidden_key))
            continue
        norm = normalize_book_title(item.title) or item.title.casefold()
        if norm in existing:
            continue
        existing.add(norm)
        book = ManualBook(user_id=user_id, title=item.title, title_norm=norm[:300], author=item.author)
        db.add(book)
        db.flush()
        added.append((item, f"m:{book.id}"))

    # read now: off the list of books to read
    idx = catalog.index(db)
    works = {w.key for w in (book_face.work_of(idx, title=i.title) for i, _ in added) if w is not None}
    norms = {normalize_book_title(i.title) for i, _ in added}
    for row in db.execute(select(WantBook).where(WantBook.user_id == user_id)).scalars():
        work = book_face.work_of(idx, row.work_key, title=row.title)
        if (work is not None and work.key in works) or row.title_norm in norms:
            db.delete(row)
    db.commit()

    # a mark given before a book was taken off the shelf comes back with it (only readers who have marks pay for it)
    if db.execute(select(BookReview.id).where(BookReview.user_id == user_id).limit(1)).first() is not None:
        for item, key in added:
            want.reattach_mark(db, user_id, item.title, key)
    return items, len(added)
