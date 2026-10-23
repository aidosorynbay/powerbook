"""A reader's bookcase: every book they finished, and every file they brought
to read here, on one shelf.

The two sources describe the same object from opposite ends. A round log or a
hand-added entry says "I finished this"; an upload says "I have the text".
Where both name the same book they become one volume — finished *and*
readable — instead of two copies standing side by side.
"""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import authors as names
from app.core.constants import ROUND_TZ
from app.core.booktitles import canonical_key, matching_key, matching_title
from app.services import book_notes, covers, custom_shelves, shelf_overrides
from app.models.library import LibraryBook
from app.models.manual_book import ManualBook
from app.models.round import ReadingLog, Round
from app.models.user import User
from app.repositories.claims import ClaimsRepository
from app.repositories.insights import normalize_book_title
from app.repositories.library import LibraryRepository
from app.repositories.users import UserRepository
from app.schemas.library import (
    BookcaseBookOut,
    BookNoteOut,
    BookcaseOut,
    CustomShelfOut,
    BookcaseOwnerOut,
    FellowReaderOut,
)

# A first line longer than this is an impression, not a title. It still goes
# on the spine — the reader wrote it — but cut down to something a spine holds.
_SPINE_TITLE_CHARS = 80



# A book given minutes this many days ago, never finished and on no shelf, still stands there as «Читаю».
READING_LATELY_DAYS = 60


def _short_hash(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]


def _split_comment(comment: str) -> tuple[str, str | None, str | None]:
    """(title, author, note) from a finished-day comment.

    People write the day's comment, not a title field. A quoted fragment is
    the title and a short remainder on the same line is almost always the
    author («Грозовой перевал» Эмили Бронте). Anything beyond the first line
    is what the book did to them — kept as the note, which is the most
    personal thing on the shelf.
    """
    text = comment.strip()
    first = text.split("\n", 1)[0].strip()
    quoted = matching_title(text)
    author = None

    if quoted and quoted != first:
        rest = first.replace(quoted, "", 1).strip(" \t-—–,.:;«»\"'“”„")
        if rest and len(rest) <= 40 and len(rest.split()) <= 4:
            author = rest

    # "Теори игр (наконееееец)" goes on the spine as "Теори игр"; the aside
    # stays in the note, where the reader's relief belongs.
    title = covers.clean_title(text)
    if not title:
        title = first if len(first) <= _SPINE_TITLE_CHARS else first[: _SPINE_TITLE_CHARS - 1].rstrip() + "…"

    said = len(title) + len(author or "")
    note = text if len(text) > said + 12 else None
    return title, author, note


def _upload_status(progress: int) -> str:
    if progress >= 100:
        return "finished"
    return "reading" if progress > 0 else "unread"


class BookcaseService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.users = UserRepository(db)
        self.claims = ClaimsRepository(db)
        self.library = LibraryRepository(db)
        # Titles on the last shelf built that the internet hasn't been asked
        # about yet: cover key -> (title to search, author hint).
        self.pending_lookups: dict[str, tuple[str, str | None]] = {}

    # ---------- whose shelf ----------

    def _owner_ids(self, owner: User) -> list[uuid.UUID]:
        """Every account this shelf speaks for.

        A member's claimed archive nicknames, or — for an unclaimed archive
        record — the other spellings the import linked to the same person.
        """
        ids = list(self.claims.effective_user_ids(user_id=owner.id))
        if owner.is_claimable and owner.person_id:
            claimed = set(self.claims.approved_owner_by_ghost())
            stmt = select(User.id).where(User.person_id == owner.person_id, User.is_claimable.is_(True))
            ids += [row[0] for row in self.db.execute(stmt).all() if row[0] not in claimed and row[0] not in ids]
        return ids

    # ---------- the shelf ----------

    def bookcase(self, *, owner_id: uuid.UUID, viewer_id: uuid.UUID) -> BookcaseOut:
        owner = self.users.get(owner_id)
        if owner is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

        is_self = owner.id == viewer_id
        ids = self._owner_ids(owner)

        volumes: list[BookcaseBookOut] = []
        by_norm: dict[str, BookcaseBookOut] = {}
        by_key: dict[str, BookcaseBookOut] = {}

        def remember(vol: BookcaseBookOut, norm: str) -> None:
            volumes.append(vol)
            by_norm[norm] = vol
            if vol.match_key:
                by_key[vol.match_key] = vol

        def find(norm: str, key: str | None) -> BookcaseBookOut | None:
            return by_norm.get(norm) or (by_key.get(key) if key else None)

        # What to search online for each volume: its cleaned title and, when
        # known, an author to tell editions apart.
        lookups: dict[str, tuple[str, str | None]] = {}

        # 1. Finished in a round. A private comment is hidden from the circle
        #    on the calendar, so it stays off the shelf anyone else sees too.
        stmt = (
            select(ReadingLog.comment, ReadingLog.date, ReadingLog.is_comment_private, Round.year, Round.month)
            .join(Round, Round.id == ReadingLog.round_id)
            .where(
                ReadingLog.user_id.in_(ids),
                ReadingLog.book_finished.is_(True),
                ReadingLog.comment.is_not(None),
            )
            .order_by(ReadingLog.date.asc())
        )
        for comment, day, is_private, year, month in self.db.execute(stmt).all():
            if not comment or not comment.strip():
                continue
            if is_private and not is_self:
                continue
            norm = normalize_book_title(comment)
            key = matching_key(comment)
            title, author, note = _split_comment(comment)

            existing = find(norm, key)
            if existing is not None:
                # Read again: the later finish is the one the reader remembers.
                existing.times_finished += 1
                existing.finished_on = day.isoformat()
                existing.round_year, existing.round_month = year, month
                if note:
                    existing.note = note
                existing.note_is_private = existing.note_is_private or bool(is_private)
                continue

            if covers.clean_title(comment):
                lookups[f"r:{_short_hash(norm)}"] = (title, author)
            remember(
                BookcaseBookOut(
                    key=f"r:{_short_hash(norm)}",
                    title=title,
                    # «Очень понравилось» after the title is no author; the lookup still hears it, it may be «ремарк».
                    author=author if names.looks_like_name(author) else None,
                    note=note,
                    note_is_private=bool(is_private),
                    status="finished",
                    source="round",
                    finished_on=day.isoformat(),
                    round_year=year,
                    round_month=month,
                    times_finished=1,
                    match_key=key,
                    fellow_readers=0,
                    has_file=False,
                    file_format=None,
                    file_size=None,
                    cover_data=None,
                    progress_percent=100,
                    last_read_at=None,
                ),
                norm,
            )

        # 2. Finished outside the circles, added by hand.
        stmt = select(ManualBook).where(ManualBook.user_id.in_(ids)).order_by(ManualBook.created_at.asc())
        for book in self.db.execute(stmt).scalars().all():
            key = canonical_key(book.title)
            if find(book.title_norm, key) is not None:
                continue
            clean = covers.clean_title(book.title)
            if clean:
                lookups[f"m:{book.id}"] = (clean, book.author)
            remember(
                BookcaseBookOut(
                    key=f"m:{book.id}",
                    title=book.title,
                    author=book.author,
                    note=None,
                    status="finished",
                    source="manual",
                    finished_on=book.finished_on.isoformat() if book.finished_on else None,
                    round_year=None,
                    round_month=None,
                    times_finished=1,
                    match_key=key,
                    fellow_readers=0,
                    has_file=False,
                    file_format=None,
                    file_size=None,
                    cover_data=None,
                    progress_percent=100,
                    last_read_at=None,
                    manual_id=book.id if is_self else None,
                ),
                book.title_norm,
            )

        # 3. Files brought to read here. Someone else only ever sees the ones
        #    left visible, and never anything that reaches the file itself.
        uploads: list[LibraryBook] = (
            self.library.list_for_user(user_id=owner.id)
            if is_self
            else self.library.list_visible_for_buddy(owner_id=owner.id)
        )
        added_on: dict[str, str] = {}
        # The reader's own word on a file (a fixed title, «Какая это книга?») says which book it is when its file name
        # does not: «Dumas_Graf_Monte-Kristo_tom2…» renamed «Граф Монте-Кристо 2» is the finished copy on the shelf.
        said = {} if owner.is_claimable else shelf_overrides.overrides_for(self.db, owner.id)
        for up in uploads:
            norm = normalize_book_title(up.title)
            key = canonical_key(up.title)
            vol = find(norm, key)
            o = said.get(f"u:{up.id}")
            if vol is None and o is not None and o.title:
                vol = find(normalize_book_title(o.title) or o.title.casefold(), canonical_key(o.title)) or find("", matching_key(o.title))
            if vol is None and o is not None and o.work_key:
                vol = by_key.get(o.work_key)
            if vol is None:
                vol = BookcaseBookOut(
                    key=f"u:{up.id}",
                    title=up.title,
                    author=up.author,
                    note=None,
                    status=_upload_status(up.progress_percent),
                    source="upload",
                    finished_on=None,
                    round_year=None,
                    round_month=None,
                    times_finished=0,
                    match_key=key,
                    fellow_readers=0,
                    has_file=True,
                    file_format=None,
                    file_size=None,
                    cover_data=None,
                    progress_percent=up.progress_percent,
                    last_read_at=None,
                )
                remember(vol, norm)
                clean = covers.clean_title(up.title.replace("_", " "))
                if clean:
                    lookups[vol.key] = (clean, up.author)
            elif vol.has_file:
                # Two files of one book: the one read most recently represents it.
                continue

            added_on[vol.key] = (up.last_read_at or up.created_at).date().isoformat()
            vol.has_file = True
            vol.file_format = up.file_format
            vol.file_size = up.file_size
            vol.cover_data = up.cover_data
            vol.last_read_at = up.last_read_at
            vol.author = vol.author or up.author
            if vol.source != "upload":
                # Finished already; the file is a re-read or a keepsake.
                vol.progress_percent = up.progress_percent
            if is_self:
                vol.upload_id = up.id
                vol.is_visible_to_buddies = up.is_visible_to_buddies

        # 4. Time spent: the minutes the reader's days gave each book, every spelling of it together (book_time:
        #    «Что читаю», the reading room, the reader). A book read lately that is on no shelf yet stands there
        #    as «Читаю», so the time given it is never lost.
        from app.services import book_time, catalog

        idx = catalog.index(self.db)
        vol_of: dict[str, BookcaseBookOut] = {}
        held = {vk: work.key for work in idx.works.values() for account, vk in work.holders.items() if account in ids}
        # a file the reader said is a certain book («Какая это книга?», or a fixed title) counts as that book, whatever
        # its file name: its minutes from the reader and from «Что читаю» meet there
        for vol in volumes:
            o = said.get(vol.key)
            pinned = idx.find(o.work_key) if o is not None and o.work_key else None
            for key in (held.get(vol.key), pinned.key if pinned else None,
                        book_time.book_of(idx, o.title) if o is not None and o.title else None, book_time.book_of(idx, vol.title)):
                if key:
                    vol_of.setdefault(key, vol)
        today = datetime.now(tz=ROUND_TZ).date()
        for bt in sorted(book_time.of_readers(self.db, list(ids), idx).values(), key=lambda b: b.last_day or today):
            # the library's word first, then the shelf's own: the same title or the same key as a book already there
            vol = vol_of.get(bt.key) or next(
                (v for t in sorted(bt.titles) if (v := find(normalize_book_title(t) or t.casefold(), matching_key(t))) is not None),
                None,
            )
            if vol is None:
                if bt.finished or bt.last_day is None or (today - bt.last_day).days > READING_LATELY_DAYS:
                    continue
                vol = BookcaseBookOut(
                    key=f"l:{_short_hash(bt.key)}", title=bt.title, author=None, note=None,
                    status="reading", source="log", finished_on=None, round_year=None, round_month=None,
                    times_finished=0, match_key=matching_key(bt.title), fellow_readers=0, has_file=False,
                    file_format=None, file_size=None, cover_data=None, progress_percent=0, last_read_at=None,
                )
                remember(vol, normalize_book_title(bt.title) or bt.title.casefold())
                vol_of[bt.key] = vol
                clean = covers.clean_title(bt.title)
                if clean:
                    lookups[vol.key] = (clean, None)
                added_on[vol.key] = bt.last_day.isoformat()
            vol.minutes_read += bt.minutes
            vol.days_read += bt.days
            if is_self:
                vol.read_as = sorted(set(vol.read_as) | bt.titles)

        # The reader's own corrections: a fixed title is what gets looked up,
        # and then their title, author and cover choice sit over whatever the
        # lookup found. An archive record has nobody to make them.
        overrides = {} if owner.is_claimable else shelf_overrides.overrides_for(self.db, owner.id)
        for vol in volumes:
            override = overrides.get(vol.key)
            if override and override.title:
                hint = override.author or lookups.get(vol.key, (None, None))[1]
                lookups[vol.key] = (covers.clean_title(override.title) or override.title, hint)

        self._apply_covers(volumes, lookups)

        for vol in volumes:
            override = overrides.get(vol.key)
            if override is None:
                continue
            if override.title:
                vol.title = override.title
            if override.author:
                vol.author = override.author
            if override.cover_mode == "none":
                vol.cover_url = vol.cover_thumb_url = vol.source_url = vol.cover_data = None
            elif override.cover_mode == "image" and override.image:
                # The reader's pick wins even over the cover inside their file.
                vol.cover_data = None
                vol.cover_url = f"/library/covers/{override.image}.jpg"
                vol.cover_thumb_url = f"/library/covers/{override.image}-s.jpg"
                vol.source_url = (
                    f"https://books.google.com/books?id={override.source_id}"
                    if override.source == "google" and override.source_id
                    else None
                )
            if override.finished_on:
                # «Когда дочитали», the reader's own word over the days or the entry
                vol.finished_on = override.finished_on.isoformat()
            if override.work_key:
                # The owner said which book this is: it counts as that book everywhere.
                vol.match_key = override.work_key
                vol.pinned = True
            if is_self:
                vol.cover_mode = override.cover_mode
                vol.edited = True

        # A book standing as «Читаю» from the days alone that turns out, under the reader's own titles, to be a
        # book already on the shelf is that book: its time goes there, and it does not stand twice.
        named = {}
        for vol in volumes:
            if vol.source != "log":
                for k in (vol.title.casefold(), vol.match_key):
                    if k:
                        named.setdefault(k, vol)
        for vol in [v for v in volumes if v.source == "log"]:
            twin = named.get(vol.title.casefold()) or (named.get(vol.match_key) if vol.match_key else None)
            if twin is not None:
                twin.minutes_read += vol.minutes_read
                twin.days_read += vol.days_read
                twin.read_as = sorted(set(twin.read_as) | set(vol.read_as))
                volumes.remove(vol)

        # One book, one face (book_face): a copy that is a book of the shared library shows the library's title
        # spelling, author and cover, not its own comment's, file's or spelling's lookup's — «Три товарища» had
        # two authors on different shelves and another cover on the founder's shelf than on the library's card.
        # Only what the reader chose for this copy stays theirs.
        from app.services import book_face

        for vol in volumes:
            work = book_face.work_of(idx, held.get(vol.key), vol.match_key, title=vol.title)
            if work is not None:
                book_face.dress(vol, work, overrides.get(vol.key))

        # «Убрать с полки»: what the reader said is no book (a day's comment) is off the shelf. They alone still get
        # it, marked, to bring it back.
        gone = {k for k, o in overrides.items() if o.hidden}
        if gone:
            volumes = [v for v in volumes if v.key not in gone or is_self]
            for v in volumes:
                v.hidden = v.key in gone

        # Where each book stands in the owner's bookcase. An archive record
        # has nobody to arrange it.
        shelves: list[CustomShelfOut] = []
        if not owner.is_claimable:
            shelves = [CustomShelfOut.model_validate(s) for s in custom_shelves.shelves_for(self.db, owner.id)]
            placed = custom_shelves.placements_for(self.db, owner.id)
            for vol in volumes:
                vol.shelf_id = placed.get(vol.key)

        # The owner's own notes, never anyone else's.
        if is_self and not owner.is_claimable:
            notes = book_notes.notes_for(self.db, owner.id)
            for vol in volumes:
                vol.notes = [BookNoteOut.model_validate(n) for n in notes.get(vol.key, [])]

        # The owner's marks and reviews, on their shelf for anyone to see.
        if not owner.is_claimable:
            from app.services import books, catalog

            marks = books.reviews_for_shelf(self.db, owner.id)
            by_volume = {r.volume_key: r for r in marks if r.volume_key}
            by_work = {r.work_key: r for r in marks}
            for vol in volumes:
                review = (
                    by_volume.get(vol.key)
                    or by_work.get(vol.work_key or "")
                    or by_work.get(vol.match_key or "")
                    or by_work.get(catalog.work_key(vol.title) or "")
                )
                if review is None:
                    continue
                vol.rating = review.rating
                vol.review = review.text
                if is_self:
                    vol.review_id = review.id

        # Readers waiting for books the owner has finished: «N читателей ищут эту книгу».
        if is_self and not owner.is_claimable:
            from sqlalchemy import select as _select

            from app.models.notification import BookWatch
            from app.services import catalog as _catalog

            idx = _catalog.index(self.db)
            wanted: dict[str, set] = {}
            for key, user_id in self.db.execute(_select(BookWatch.work_key, BookWatch.user_id)).all():
                work = idx.find(key)
                if work is not None and idx.person_of(user_id) != idx.person_of(owner.id):
                    wanted.setdefault(work.key, set()).add(user_id)
            if wanted:
                for vol in volumes:
                    if vol.status != "finished":
                        continue
                    work = book_face.work_of(idx, vol.work_key, vol.match_key, title=vol.title)
                    if work is not None:
                        vol.wanted_by = len(wanted.get(work.key, ()))

        # Who else read each book: the people its card in the shared library lists under «Читали в PowerBook»
        # (finished it in a circle, added it by hand or marked it), not only those who spelled its title the way
        # this reader did — «Три товарища» showed one fellow reader on the founder's shelf and five on its card.
        own_people = {idx.person_of(i) for i in ids}
        for vol in volumes:
            work = idx.find(vol.work_key) if vol.work_key else None
            vol.fellow_readers = len(work.readers - own_people) if work is not None else 0
            if vol.status == "finished" and vol.finished_on:
                vol.shelved_on = vol.finished_on
            elif vol.key in added_on:
                vol.shelved_on = added_on[vol.key]
            else:
                vol.shelved_on = vol.finished_on

        # Newest first; undated hand-added books sink rather than sorting as
        # if they were read in year zero.
        volumes.sort(key=lambda v: v.shelved_on or "", reverse=True)

        return BookcaseOut(
            owner=BookcaseOwnerOut(
                user_id=str(owner.id),
                username=owner.username,
                display_name=owner.display_name or owner.username,
                avatar_data=owner.avatar_data,
                is_archive=owner.is_claimable,
            ),
            is_self=is_self,
            books=volumes,
            shelves=shelves,
        )

    # ---------- covers ----------

    def _apply_covers(self, volumes: list[BookcaseBookOut], lookups: dict[str, tuple[str, str | None]]) -> None:
        """Dress each volume in what the internet knows about it, and note
        the titles not yet looked up so the request can fetch them after it
        has answered. A reader's own spelling stays unless the match was
        close enough to be a typo; their own author note always stays."""
        keys = {vol_key: covers.cover_key(query) for vol_key, (query, _) in lookups.items()}
        rows = covers.cached(self.db, list(keys.values()))
        self.pending_lookups = {}
        for vol in volumes:
            key = keys.get(vol.key)
            if key is None:
                continue
            row = rows.get(key)
            if covers.wants_lookup(row):
                self.pending_lookups[key] = lookups[vol.key]
            if row is None or row.status != "found":
                continue
            if row.title:
                vol.title = row.title
            if row.author and not vol.author:
                vol.author = row.author
            if row.image:
                vol.cover_url = f"/library/covers/{row.image}.jpg"
                vol.cover_thumb_url = f"/library/covers/{row.image}-s.jpg"
            if row.source == "google" and row.source_id:
                vol.source_url = f"https://books.google.com/books?id={row.source_id}"

    # ---------- who else read it ----------

    def fellow_readers(
        self, *, key: str, owner_id: uuid.UUID, viewer_id: uuid.UUID, limit: int = 24
    ) -> list[FellowReaderOut]:
        owner = self.users.get(owner_id)
        if owner is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

        # The shared library's readers of the book (book_face): its card lists the same people.
        from app.services import catalog

        idx = catalog.index(self.db)
        work = idx.find(key)
        if work is None:
            return []
        people = work.readers - {idx.person_of(i) for i in self._owner_ids(owner)}
        if not people:
            return []

        viewer_person = idx.person_of(viewer_id)
        account_ids = [idx.account_of(p) for p in people]
        found = self.db.execute(
            select(User.id, User.display_name, User.username, User.avatar_data, User.is_claimable).where(
                User.id.in_(account_ids)
            )
        ).all()

        out = [
            FellowReaderOut(
                user_id=str(uid),
                display_name=display_name or username,
                avatar_data=avatar,
                is_archive=bool(is_archive),
                is_viewer=idx.person_of(uid) == viewer_person,
            )
            for uid, display_name, username, avatar, is_archive in found
        ]
        # The viewer first, then members with a face, then the archive.
        out.sort(key=lambda r: (not r.is_viewer, r.is_archive, r.avatar_data is None, r.display_name.lower()))
        return out[:limit]
