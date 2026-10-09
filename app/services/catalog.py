"""The shared library: every book any PowerBook reader has on a shelf, once.

Each shelf spells its books its own way — "Теори игр", «Теория игр»,
"Теория игр (наконец)" — and the same book turns up in Cyrillic and in Latin.
One book of the shared library gathers every spelling that is plainly the
same book: the same comparison key (app.core.booktitles), the title the
cover lookup corrected it to, or the same catalogue edition the lookup
matched. Those links are followed transitively, so "Теори игр" joins
«Теория игр» through the edition both were matched to.

Two more links are people's word rather than spelling: a reader who said
which book their copy is («Какая это книга?», shelf_overrides.work_key),
whatever its file or edition was called; and the founder's links between
two books that are one (book_links), such as a translation and its
original.

What goes in: books finished in a round (a private comment stays out, as
it does off every shelf but its owner's), books added by hand, and any book
a reader has given a mark, since a mark is public by nature.

Building the index reads every finished book on the platform. It is kept
per process for a few minutes; marks, facts and listings are read fresh on
every request and only looked up against it.
"""
from __future__ import annotations

import os
import tempfile
import threading
import time
import uuid
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.booktitles import canonical_key, match_key, matching_key
from app.models.book_cover import BookCover
from app.models.book_link import BookLink
from app.models.book_review import BookReview
from app.models.manual_book import ManualBook
from app.models.round import ReadingLog
from app.models.shelf_override import ShelfOverride
from app.models.user import User
from app.repositories.claims import ClaimsRepository
from app.repositories.insights import normalize_book_title
from app.services import covers

_TTL_SECONDS = 300
_cache: dict[str, object] = {"at": 0.0, "index": None, "stamp": 0.0}
_building = threading.Lock()
# The server runs as two processes, each with its own copy of the index. A
# change made in one (a book pinned, a mark given) is told to the other by
# this file's time: without it the other went on showing the old library
# for up to five minutes, and a reader who had just said which book their
# copy is saw nothing change.
_STAMP = os.path.join(tempfile.gettempdir(), "powerbook-catalog.stamp")


@dataclass
class Work:
    """One book of the shared library."""

    key: str
    members: set[str]
    title: str
    author: str | None
    image: str | None
    source_url: str | None
    # People (not accounts) who finished or marked it.
    readers: set[uuid.UUID] = field(default_factory=set)
    finishes: int = 0
    last_at: date | None = None
    # account id -> the key of this book on that account's shelf
    holders: dict[uuid.UUID, str] = field(default_factory=dict)
    search: str = ""


@dataclass
class CatalogIndex:
    works: dict[str, Work]
    by_member: dict[str, str]
    # person -> the works on their shelves, for "readers like you" suggestions
    by_person: dict[uuid.UUID, set[str]]
    fold: dict[uuid.UUID, uuid.UUID]
    representative: dict[uuid.UUID, uuid.UUID]

    def find(self, key: str | None) -> Work | None:
        if not key:
            return None
        primary = self.by_member.get(key)
        return self.works.get(primary) if primary else None

    def person_of(self, account_id: uuid.UUID) -> uuid.UUID:
        return self.fold.get(account_id, account_id)

    def account_of(self, person_id: uuid.UUID) -> uuid.UUID:
        return self.representative.get(person_id, person_id)


@dataclass
class _Entry:
    nodes: list[str]
    title: str
    author_hint: str | None
    cover: BookCover | None
    person: uuid.UUID
    account: uuid.UUID
    volume_key: str | None
    at: date | None
    # The title the reader said this copy is («Какая это книга?»).
    pinned_title: str | None = None


class _Union:
    def __init__(self) -> None:
        self.parent: dict[str, str] = {}

    def find(self, x: str) -> str:
        self.parent.setdefault(x, x)
        root = x
        while self.parent[root] != root:
            root = self.parent[root]
        while self.parent[x] != root:
            self.parent[x], x = root, self.parent[x]
        return root

    def union(self, a: str, b: str) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[rb] = ra


def work_key(title: str) -> str | None:
    """The comparison key a book's own title gives it."""
    clean = covers.clean_title(title) or title
    return canonical_key(clean)


def people(db: Session) -> tuple[dict[uuid.UUID, uuid.UUID], dict[uuid.UUID, uuid.UUID]]:
    """Accounts folded into people: a claimed archive nickname belongs to its
    claimant, and archive spellings the import linked share one person.
    Returns (account -> person, person -> an account that stands for it)."""
    fold: dict[uuid.UUID, uuid.UUID] = dict(ClaimsRepository(db).approved_owner_by_ghost())
    representative: dict[uuid.UUID, uuid.UUID] = {}
    for account_id, person_id in db.execute(
        select(User.id, User.person_id).where(User.is_claimable.is_(True), User.person_id.is_not(None))
    ).all():
        if account_id in fold:
            continue
        fold[account_id] = person_id
        representative.setdefault(person_id, account_id)
    return fold, representative


def _as_date(value: object) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return None


def _build(db: Session) -> CatalogIndex:
    from app.services.bookcase import _short_hash, _split_comment

    fold, representative = people(db)
    entries: list[_Entry] = []
    wanted_covers: set[str] = set()

    # Readers' own word on which book a copy is: (account, shelf key) -> nodes, and the title they took.
    pins: dict[tuple[uuid.UUID, str], tuple[list[str], str | None]] = {}
    for user_id, volume_key, pinned, source, source_id, pinned_title in db.execute(
        select(
            ShelfOverride.user_id, ShelfOverride.volume_key, ShelfOverride.work_key, ShelfOverride.source,
            ShelfOverride.source_id, ShelfOverride.title,
        )
        .where(ShelfOverride.work_key.is_not(None))
    ).all():
        nodes = [pinned]
        if source in ("google", "openlibrary") and source_id:
            nodes.append(f"@{source}:{source_id}")
        pins[(user_id, volume_key)] = (nodes, pinned_title)

    # what readers took off their shelves as no book at all («Убрать с полки»)
    hidden = {(u, vk) for u, vk in db.execute(
        select(ShelfOverride.user_id, ShelfOverride.volume_key).where(ShelfOverride.hidden.is_(True))
    ).all()}

    def add(raw_key: str | None, clean: str, hint: str | None, account: uuid.UUID, volume_key: str | None, at: object) -> None:
        if volume_key and ((account, volume_key) in hidden or (fold.get(account, account), volume_key) in hidden):
            return
        nodes = [k for k in dict.fromkeys([raw_key, canonical_key(clean)]) if k]
        pinned_title = None
        if volume_key:
            # A claimed archive book sits on its claimant's shelf, so their pin counts for it too.
            pinned = pins.get((account, volume_key)) or pins.get((fold.get(account, account), volume_key))
            if pinned:
                nodes.extend(k for k in pinned[0] if k not in nodes)
                pinned_title = pinned[1]
        if not nodes:
            return
        wanted_covers.add(covers.cover_key(clean))
        entries.append(
            _Entry(
                nodes=nodes,
                title=clean,
                author_hint=hint,
                cover=None,
                person=fold.get(account, account),
                account=account,
                volume_key=volume_key,
                at=_as_date(at),
                pinned_title=pinned_title,
            )
        )

    rows = db.execute(
        select(ReadingLog.user_id, ReadingLog.comment, ReadingLog.date)
        .where(
            ReadingLog.book_finished.is_(True),
            ReadingLog.comment.is_not(None),
            ReadingLog.is_comment_private.is_(False),
        )
        .order_by(ReadingLog.date.asc())
    ).all()
    for account, comment, day in rows:
        clean = covers.clean_title(comment or "")
        if not clean:
            continue
        _, author, _ = _split_comment(comment)
        add(matching_key(comment), clean, author, account, f"r:{_short_hash(normalize_book_title(comment))}", day)

    for book_id, account, title, author, finished_on, created_at in db.execute(
        select(ManualBook.id, ManualBook.user_id, ManualBook.title, ManualBook.author, ManualBook.finished_on, ManualBook.created_at)
    ).all():
        clean = covers.clean_title(title)
        if not clean:
            continue
        add(canonical_key(title), clean, author, account, f"m:{book_id}", finished_on or created_at)

    for account, key, volume_key, title, author, updated_at in db.execute(
        select(BookReview.user_id, BookReview.work_key, BookReview.volume_key, BookReview.title, BookReview.author, BookReview.updated_at)
    ).all():
        clean = covers.clean_title(title) or title
        add(key, clean, author, account, volume_key, updated_at)

    found = covers.cached(db, list(wanted_covers)) if wanted_covers else {}
    union = _Union()
    for e in entries:
        row = found.get(covers.cover_key(e.title))
        if row is not None and row.status == "found":
            e.cover = row
            if row.title:
                corrected = canonical_key(row.title)
                if corrected:
                    e.nodes.append(corrected)
            if row.source and row.source_id:
                e.nodes.append(f"@{row.source}:{row.source_id}")
        for node in e.nodes[1:]:
            union.union(e.nodes[0], node)
        union.find(e.nodes[0])
    # The founder's links between books that are one.
    for key_a, key_b in db.execute(select(BookLink.key_a, BookLink.key_b)).all():
        union.union(key_a, key_b)

    groups: dict[str, list[_Entry]] = defaultdict(list)
    for e in entries:
        groups[union.find(e.nodes[0])].append(e)

    works: dict[str, Work] = {}
    by_member: dict[str, str] = {}
    by_person: dict[uuid.UUID, set[str]] = defaultdict(set)
    for group in groups.values():
        titles: Counter[str] = Counter()
        authors: Counter[str] = Counter()
        hints: Counter[str] = Counter()
        images: Counter[str] = Counter()
        source_url = None
        for e in group:
            row = e.cover
            if e.pinned_title:
                # The reader said which book this is: their copy's old spelling
                # does not get to name it («Граф Монте-Кристо 2» joining
                # «Граф Монте-Кристо» must not rename it).
                titles[e.pinned_title] += 2
            else:
                # The corrected spelling counts double: it is the book's own.
                titles[(row.title if row is not None and row.title else e.title)] += 2 if row is not None else 1
            if row is not None and row.author:
                authors[row.author] += 1
            if e.author_hint:
                hints[e.author_hint.strip()] += 1
            if row is not None and row.image:
                images[row.image] += 1
            if source_url is None and row is not None and row.source == "google" and row.source_id:
                source_url = f"https://books.google.com/books?id={row.source_id}"
        title = titles.most_common(1)[0][0]
        members = {n for e in group for n in e.nodes if not n.startswith("@")}
        primary = canonical_key(title)
        if not primary or primary not in members:
            primary = sorted(members, key=lambda k: (-sum(k in e.nodes for e in group), k))[0]
        author = (authors.most_common(1)[0][0] if authors else None) or (hints.most_common(1)[0][0] if hints else None)
        work = Work(
            key=primary,
            members=members,
            title=title,
            author=author,
            image=images.most_common(1)[0][0] if images else None,
            source_url=source_url,
        )
        for e in group:
            work.readers.add(e.person)
            work.finishes += 1
            if e.at and (work.last_at is None or e.at > work.last_at):
                work.last_at = e.at
            if e.volume_key:
                # A round finish outranks a hand-added copy of the same book,
                # as it does on the shelf itself.
                current = work.holders.get(e.account)
                if current is None or (current.startswith("m:") and e.volume_key.startswith("r:")):
                    work.holders[e.account] = e.volume_key
            by_person[e.person].add(primary)
        work.search = f"{title} {author or ''}".casefold()
        works[primary] = work
        for member in members:
            by_member[member] = primary

    return CatalogIndex(works=works, by_member=by_member, by_person=dict(by_person), fold=fold, representative=representative)


def _stamp() -> float:
    try:
        return os.stat(_STAMP).st_mtime
    except OSError:
        return 0.0


def _fresh(stamp: float) -> CatalogIndex | None:
    cached = _cache.get("index")
    if cached is None or time.monotonic() - float(_cache["at"]) >= _TTL_SECONDS or stamp > float(_cache["stamp"]):
        return None
    return cached  # type: ignore[return-value]


def index(db: Session) -> CatalogIndex:
    stamp = _stamp()
    cached = _fresh(stamp)
    if cached is not None:
        return cached
    with _building:
        cached = _fresh(stamp)
        if cached is not None:
            return cached
        built = _build(db)
        # The stamp read before building: a change made meanwhile builds again.
        _cache["index"], _cache["at"], _cache["stamp"] = built, time.monotonic(), stamp
        return built


def invalidate() -> None:
    _cache["index"] = None
    try:
        now = time.time()
        with open(_STAMP, "a"):
            pass
        os.utime(_STAMP, (now, now))
    except OSError:  # this process at least builds afresh
        pass


def search_matches(work: Work, query: str) -> bool:
    folded = query.casefold().strip()
    if not folded:
        return True
    if folded in work.search:
        return True
    skeleton = match_key(query)
    return len(skeleton) >= 3 and any(skeleton in m for m in work.members)
