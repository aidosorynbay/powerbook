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

from app.core import authors as names
from app.core.booktitles import canonical_key, match_key, matching_key
from app.models.book_author import BookAuthor
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
    # When the sources name more than one person: each person and the weight of what named them, the chosen first.
    author_rivals: list[tuple[str, float]] = field(default_factory=list)
    # The founder said who wrote it (book_authors).
    author_fixed: bool = False
    # The cover lookups of its spellings (book_covers keys).
    cover_keys: set[str] = field(default_factory=set)
    # Its cover is an edition a reader picked (not a lookup's guess, nor a photo).
    cover_picked: bool = False
    # How the book looks under each title its copies carry, by face_key ("cyr:tritovarisha"): (spelling, cover image
    # or None). «три товарища!!» and «Три товарища» are one title with one face; a translation, a second volume or
    # the same words in Latin letters each keep their own. Every copy on every shelf shows its title's face
    # (app.services.book_face); `title` and `image` are the face of the book's own title.
    faces: dict[str, tuple[str, str | None]] = field(default_factory=dict)
    # The Google Books page of each cover image, for the link under it.
    cover_links: dict[str, str] = field(default_factory=dict)


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
    # The edition picture the reader picked for this copy.
    picked_image: str | None = None
    # A photo the reader took of this copy: the book's cover only while it has no other.
    photo_image: str | None = None
    # The author hint was typed in an author field (a book added by hand), not read off a day's comment.
    author_typed: bool = False


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


def _top(counted: Counter[str]) -> str | None:
    return counted.most_common(1)[0][0] if counted else None


def face_key(title: str) -> str:
    """Which face of a book a copy shows: the same words in the same letters («три товарища!!» and
    «Три товарища»), as the cover lookups are keyed."""
    return covers.cover_key(covers.clean_title(title) or title)


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

    # Covers readers picked from the catalogues for their copies: the strongest word on what the book looks like.
    picks = {
        (u, vk): image
        for u, vk, image in db.execute(
            select(ShelfOverride.user_id, ShelfOverride.volume_key, ShelfOverride.image).where(
                ShelfOverride.cover_mode == "image",
                ShelfOverride.image.is_not(None),
                ShelfOverride.source.in_(("google", "openlibrary")),
            )
        ).all()
    }

    # Photos readers took of their own copies. The founder (2026-10-19): a book with no cover at all takes one, on
    # every shelf and its card; a book that has a cover keeps it, and the photo stays on its own shelf.
    photos = {
        (u, vk): image
        for u, vk, image in db.execute(
            select(ShelfOverride.user_id, ShelfOverride.volume_key, ShelfOverride.image).where(
                ShelfOverride.cover_mode == "image",
                ShelfOverride.image.is_not(None),
                ShelfOverride.source == "photo",
            )
        ).all()
    }

    # the copies counted below, whose picked edition or photo reaches their book there
    dressed: set[tuple[uuid.UUID, str]] = set()

    # what readers took off their shelves as no book at all («Убрать с полки»)
    hidden = {(u, vk) for u, vk in db.execute(
        select(ShelfOverride.user_id, ShelfOverride.volume_key).where(ShelfOverride.hidden.is_(True))
    ).all()}

    def add(
        raw_key: str | None, clean: str, hint: str | None, account: uuid.UUID, volume_key: str | None, at: object,
        typed: bool = False,
    ) -> None:
        if volume_key and ((account, volume_key) in hidden or (fold.get(account, account), volume_key) in hidden):
            return
        nodes = [k for k in dict.fromkeys([raw_key, canonical_key(clean)]) if k]
        pinned_title = picked = photo = None
        if volume_key:
            picked = picks.get((account, volume_key)) or picks.get((fold.get(account, account), volume_key))
            photo = photos.get((account, volume_key)) or photos.get((fold.get(account, account), volume_key))
            dressed.update({(account, volume_key), (fold.get(account, account), volume_key)})
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
                author_typed=typed,
                picked_image=picked,
                photo_image=photo,
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
        add(canonical_key(title), clean, author, account, f"m:{book_id}", finished_on or created_at, typed=True)

    for account, key, volume_key, title, author, updated_at in db.execute(
        select(BookReview.user_id, BookReview.work_key, BookReview.volume_key, BookReview.title, BookReview.author, BookReview.updated_at)
    ).all():
        clean = covers.clean_title(title) or title
        # A mark keeps a copy of the author the library showed when it was given: no word of its own on who wrote it.
        add(key, clean, None, account, volume_key, updated_at)

    found = covers.cached(db, list(wanted_covers)) if wanted_covers else {}
    # The founder's word on who wrote a book, and every author the catalogues ever named: what tells a reader's
    # «Ремарк» (a real author, written short) from «Перечитала».
    fixed = {key: author for key, author in db.execute(select(BookAuthor.key, BookAuthor.author)).all() if author}
    known = names.Directory(
        [a for (a,) in db.execute(select(BookCover.author).where(BookCover.author.is_not(None))).all()]
        + list(fixed.values())
    )
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
        said: list[tuple[str, float]] = []
        looked_up: set[str] = set()
        heard: set[tuple[uuid.UUID, str]] = set()
        images: Counter[str] = Counter()
        # the same per title its copies carry, for each copy's face; covers readers picked apart from the lookups'
        face_titles: dict[str, Counter[str]] = defaultdict(Counter)
        face_images: dict[str, Counter[str]] = defaultdict(Counter)
        picked: Counter[str] = Counter()
        photographed: Counter[str] = Counter()
        face_picked: dict[str, Counter[str]] = defaultdict(Counter)
        links: dict[str, str] = {}
        source_url = None
        for e in group:
            row = e.cover
            if e.pinned_title:
                # The reader said which book this is: their copy's old spelling
                # does not get to name it («Граф Монте-Кристо 2» joining
                # «Граф Монте-Кристо» must not rename it).
                shown, weight = e.pinned_title, 2
            else:
                # The corrected spelling counts double: it is the book's own.
                shown, weight = (row.title if row is not None and row.title else e.title), (2 if row is not None else 1)
            titles[shown] += weight
            face = face_key(shown)
            face_titles[face][shown] += weight
            # What the copy looks like: the edition its reader picked, or else its spelling's lookup. A person's
            # choice outranks any number of lookups, which only guess.
            if e.picked_image:
                picked[e.picked_image] += 1
                face_picked[face][e.picked_image] += 1
            elif row is not None and row.image:
                images[row.image] += 1
                face_images[face][row.image] += 1
                if row.source == "google" and row.source_id:
                    links.setdefault(row.image, f"https://books.google.com/books?id={row.source_id}")
            if e.photo_image:
                photographed[e.photo_image] += 1
            # Who wrote it: one lookup is one opinion, however many readers spelled the title its way, and each
            # reader's own word after the title counts once, for as much as it looks like an author's name.
            if row is not None and row.author and row.key not in looked_up:
                looked_up.add(row.key)
                said.append((row.author, 1.0))
            hint = (e.author_hint or "").strip()
            if hint and (e.person, hint.casefold()) not in heard:
                heard.add((e.person, hint.casefold()))
                said.extend(_hint_votes(hint, known, typed=e.author_typed))
            if source_url is None and row is not None and row.source == "google" and row.source_id:
                source_url = f"https://books.google.com/books?id={row.source_id}"
        title = titles.most_common(1)[0][0]
        members = {n for e in group for n in e.nodes if not n.startswith("@")}
        primary = canonical_key(title)
        if not primary or primary not in members:
            primary = sorted(members, key=lambda k: (-sum(k in e.nodes for e in group), k))[0]
        script = names.script_of(title)
        rivals = names.people(said, prominence=known.prominence)
        author = (rivals[0].written(script) or rivals[0].written()) if rivals else None
        faces = {
            face: (counted.most_common(1)[0][0], _top(face_picked[face]) or _top(face_images[face]))
            for face, counted in face_titles.items()
        }
        # The card shows its own title's face, so its cover is never a translation's or another volume's edition.
        image = faces.get(face_key(title), (None, None))[1] or _top(picked) or _top(images)
        # Only a book nobody found a cover for takes a reader's photo, and only as the book's own (not a title's
        # face): a copy with a picture of its own, a file's cover say, keeps it (book_face.dress).
        image = image or _top(photographed)
        work = Work(
            key=primary,
            members=members,
            title=title,
            author=author,
            image=image,
            source_url=links.get(image or "") or source_url,
            author_rivals=[(p.written(script) or p.written() or p.names[0], round(p.weight, 2)) for p in rivals]
            if len(rivals) > 1
            else [],
            cover_keys={covers.cover_key(e.title) for e in group},
            cover_picked=bool(face_picked[face_key(title)] or picked),
            faces=faces,
            cover_links=links,
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

    # The founder's word on who wrote a book is the last one.
    for key, author in fixed.items():
        work = works.get(by_member.get(key, ""))
        if work is not None:
            work.author = author[:200]
            work.author_fixed = True
            work.search = f"{work.title} {work.author}".casefold()

    idx = CatalogIndex(works=works, by_member=by_member, by_person=dict(by_person), fold=fold, representative=representative)
    _dress_from_other_copies(
        db, idx,
        picks={k: v for k, v in picks.items() if k not in dressed},
        photos={k: v for k, v in photos.items() if k not in dressed},
        pins=pins,
    )
    return idx


def _dress_from_other_copies(
    db: Session,
    idx: CatalogIndex,
    *,
    picks: dict[tuple[uuid.UUID, str], str],
    photos: dict[tuple[uuid.UUID, str], str],
    pins: dict[tuple[uuid.UUID, str], tuple[list[str], str | None]],
) -> None:
    """Covers chosen on copies the shared library is not built from: a book being read («Читаю», `l:`) and a file
    (`u:`). The founder photographed «Гауһар тас», being read, and the library's card stayed bare (2026-10-20): only
    finished, hand-added and marked copies used to count. Each such copy is found as the shelf finds it — the reader's
    pin, then its days' minutes (book_time) or its file's title — and dresses its book by the same rules: a picked
    edition outranks lookups, a photo only covers a book with no cover at all."""
    if not picks and not photos:
        return
    from app.models.library import LibraryBook
    from app.services import book_time
    from app.services.bookcase import _short_hash

    wanted = set(picks) | set(photos)
    titles: dict[tuple[uuid.UUID, str], str] = {
        (u, vk): t
        for u, vk, t in db.execute(
            select(ShelfOverride.user_id, ShelfOverride.volume_key, ShelfOverride.title).where(
                ShelfOverride.title.is_not(None),
                ShelfOverride.user_id.in_({u for u, _vk in wanted}),
            )
        ).all()
    }
    files: dict[str, str] = {}
    file_ids = []
    for _u, vk in wanted:
        if vk.startswith("u:"):
            try:
                file_ids.append(uuid.UUID(vk[2:]))
            except ValueError:
                pass
    if file_ids:
        files = {f"u:{i}": t for i, t in db.execute(select(LibraryBook.id, LibraryBook.title).where(LibraryBook.id.in_(file_ids))).all()}
    days: dict[uuid.UUID, dict[str, str]] = {}

    def work_of(user: uuid.UUID, vk: str) -> Work | None:
        pinned = pins.get((user, vk))
        if pinned and (work := idx.find(pinned[0][0])) is not None:
            return work
        title = titles.get((user, vk))
        if vk.startswith("l:"):
            if user not in days:
                days[user] = {f"l:{_short_hash(bt.key)}": bt.key for bt in book_time.of_readers(db, [user], idx).values()}
            key = days[user].get(vk)
            if key and (work := idx.works.get(key)) is not None:
                return work
        elif vk.startswith("u:"):
            title = title or files.get(vk)
        if not title:
            return None
        return idx.find(matching_key(title)) or idx.find(work_key(title))

    picked: dict[str, Counter[str]] = defaultdict(Counter)
    photographed: dict[str, Counter[str]] = defaultdict(Counter)
    for (user, vk), image in picks.items():
        if (work := work_of(user, vk)) is not None:
            picked[work.key][image] += 1
    for (user, vk), image in photos.items():
        if (work := work_of(user, vk)) is not None:
            photographed[work.key][image] += 1
    for key, counted in picked.items():
        work = idx.works[key]
        if work.cover_picked:
            continue  # the copies it is built from already picked one
        work.image, work.cover_picked = _top(counted), True
        own = face_key(work.title)
        work.faces[own] = (work.faces.get(own, (work.title, None))[0], work.image)
    for key, counted in photographed.items():
        work = idx.works[key]
        if work.image is None:
            work.image = _top(counted)


def _hint_votes(hint: str, known: names.Directory, *, typed: bool = False) -> list[tuple[str, float]]:
    """What a reader's words say about who wrote a book.

    A name the catalogues know as one author («Ремарк», even «ремарк») is a
    reader vouching for a real author: worth more than a single lookup, which
    may have caught a translator or another book of the same title. It votes
    in the catalogues' own spellings, so the book prints the full name. Any
    other name typed in an author field counts as much as a lookup; a
    name-like word after a title, unknown, for less; «перечитала» for nothing.
    """
    if not names.looks_like_name(hint, capitals=False):
        return []
    spellings = known.find(hint)
    if spellings and len(names.people((s, 1.0) for s in spellings)) == 1:
        own = [(hint, 0.01)] if names.looks_like_name(hint) else []
        return [(s, 1.5 / len(spellings)) for s in spellings] + own
    if typed:
        return [(hint, 1.0)]
    if names.looks_like_name(hint):
        return [(hint, 0.75 if len(hint.split()) > 1 else 0.5)]
    return []


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
