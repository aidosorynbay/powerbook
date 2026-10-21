"""«Что почитать дальше»: the AI librarian.

The founder (2026-10-21): from a reader's marks, the AI suggests what to read next and says why, and one tap puts a
book on «Хочу прочитать». Free for everyone, veterans and newcomers alike (the founder, same day: aim long term, not
only the club's library, no paywall).

How it picks, so it never names a book that does not exist:

1. From the club: every book of the shared library the reader does not know yet, ranked by how it fits their taste
   read deeply (app/services/taste.py): each book's DNA — mood, pace, themes, style (app/services/book_dna.py) —
   against the reader's portrait from everything they marked, finished, dropped, wanted and turned down; what kindred
   readers (who agree with them across many shared marks, not one) thought of it; and its quality — kept varied, no
   author twice. Each carries its match percent and the traits it fits by.
2. From the world: the AI may also name books outside the library; one counts only when a catalogue (Google Books,
   Open Library, Flip.kz) has an edition by the same author with a cover (app/services/book_lookup.py).
3. The AI (llm.py: DeepSeek or Claude) gets the reader's taste — marks with their words, recent books, their three
   favourite books (a newcomer's first step), «Хочу прочитать», «Не моё», topics — chooses by id and names outside
   books, and writes why each one in the reader's language. An id that is not a candidate, a book that cannot be
   found, or a «why» quoting a book the reader never had is dropped. Three are shown: two from the club and one from
   the world when there are.
4. What it learns from: every new mark, «Хочу прочитать», «Уже читал(а)» and «Не моё» change the taste, and the
   picks are written again the next time they are opened.

It also comes by itself: a mark of 8 and up writes fresh picks in the background (the bell for it is built, off).
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import re
import threading
import uuid
from collections import Counter
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.ai_digest import AiDigest
from app.models.book_dismissal import BookDismissal
from app.models.book_review import BookReview
from app.models.enums import SystemRole
from app.models.user import User
from app.repositories.claims import ClaimsRepository
from app.schemas.books import CatalogItemOut
from app.schemas.reading_ai import PickOut, PicksOut
from app.services import books as books_service
from app.services import book_dna, book_face, catalog, llm

logger = logging.getLogger(__name__)

# Everyone, free (the founder, 2026-10-21); False would keep it to admins.
FOR_EVERYONE = True

KIND = "picks"
SCOPE = "next"
PICKS = 3
# Asked for a few more than shown, so a pick whose «why» does not hold up can be dropped.
ASK = 5
# Fewer books known than this (marked, or finished without a mark): no picks yet, the reader is asked to mark a few
# books first (council 2026-10-21: weak picks on a first look are worse than none).
MIN_KNOWN = 3
CANDIDATES = 60
# Of the three shown, this many from the club when it has them; the rest from the world.
FROM_CLUB = 2
# Outside books the AI names, and how many of them are looked up (a lookup takes seconds).
OUTSIDE = 4
OUTSIDE_LOOKUPS = 3
# A reader's own ask («что-то лёгкое на казахском»): at most this long.
WISH_CHARS = 200
# Reading pace for «≈ N дней»: minutes a page, a novel's average.
MINUTES_A_PAGE = 1.3
# A mark this high is the moment to suggest what next.
LOVED = 8
# The picks that come by themselves: at most this often.
AUTO_EVERY = timedelta(hours=20)
# The bell says so too. Off until the picks have proved themselves (council 2026-10-21: one obvious pick teaches
# readers to ignore the bell, where reminders and the war speak); the line under the mark form stays.
AUTO_BELL = False

_LANG_NAMES = {"ru": "Russian", "kk": "Kazakh", "en": "English"}

_SYSTEM = (
    "You are the librarian of PowerBook, a reading community. A member wants to know what to read next. You get "
    "their taste — the books they marked out of 10 (with their own words, when they wrote some), what they read "
    "lately, what they already want to read, what they turned down («not for me»), their favourite topics — and a "
    "list of candidate books from the community's library, each with an id. Do two things. "
    "The reader's `portrait` is their taste read from everything they marked, finished, dropped and turned down "
    "(trait words like mood:warm, pace:slow, themes:friendship): `likes` and `dislikes`. Each candidate carries "
    "`match_percent` (how well its traits fit that portrait), `fits_their_taste`, `against_their_taste`, an "
    "`essence`, and `loved_by` — kindred club members who loved it, with how often they agree with the reader. "
    "1) `picks`: choose up to {n} candidates, by their ids only — the ones that truly fit: weigh the match, the "
    "reader's own marks and words, and kindred readers; skip a high match that clashes with what they marked low. "
    "2) `outside`: name {m} real, published books NOT among the candidates that this reader would love — well known "
    "enough to be in Google Books, with the title as published in the reader's language when there is such an "
    "edition (Russian for Russian readers; a Kazakh book in Kazakh) and the author's full name. Never a book from "
    "their marks, reads, favourites, want list or «not for me». "
    "Vary everything: not all one author or one topic, and one may be a little outside their habit if their marks "
    "point there. For each book, say why in one or two short sentences, speaking to the reader directly. The reason "
    "is what the book is like and why that is them: name its qualities in plain words of {lang} (never English trait "
    "words like «melancholic» or «literary» in a Russian or Kazakh text) and tie "
    "them to the reader's own books («медленная и тёплая книга о дружбе — как «Три товарища», которым вы дали 9»). "
    "A kindred reader is the second voice, when it adds something: by name, with how often they agree with the reader "
    "(«Айгерим, с которой вы совпали в 6 книгах из 7, поставила ей 10»). Put "
    "book titles in «». Never invent plot details, awards or facts you are not sure of. Speak of books and people, "
    "never of «topics», «themes in your profile», data or how you know. Also write one short sentence (at most 20 "
    "words) that sums up their taste as you see it. When the reader wrote a `wish` — what they want right now (a "
    "mood, a genre, a length, a language, «like …») — follow it first and let their taste choose within it; then the "
    "summary sentence answers the wish. Write everything in {lang}, plainly, no flattery. Address the reader "
    "politely and the same way every time (in Russian always «вы», in Kazakh always «сіз»); speak of a club member by "
    "their `gender` (поставила / поставил), and when it is unknown, without gendered words."
)

_SCHEMA = {
    "type": "object",
    "properties": {
        "taste": {"type": "string"},
        "picks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"id": {"type": "string"}, "why": {"type": "string"}},
                "required": ["id", "why"],
                "additionalProperties": False,
            },
        },
        "outside": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"title": {"type": "string"}, "author": {"type": "string"}, "why": {"type": "string"}},
                "required": ["title", "author", "why"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["taste", "picks", "outside"],
    "additionalProperties": False,
}


def _bad(detail: str, code: int = status.HTTP_400_BAD_REQUEST) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


def enabled_for(user: User) -> bool:
    return FOR_EVERYONE or user.system_role in (SystemRole.admin, SystemRole.superadmin)


def _cut(text: str | None, limit: int) -> str | None:
    if not text:
        return None
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _about(fact, lang: str) -> str | None:
    found = books_service._localized(fact.about if fact else None, lang)
    return _cut(found[1].get("text"), 240) if found else None


class _Reader:
    """Everything the picks are made of, gathered once."""

    def __init__(self, db: Session, user: User) -> None:
        from app.services import want
        from app.services.reading_ai import _shelf

        self.idx = catalog.index(db)
        self.facts = books_service.facts_by_work(db, self.idx)
        accounts = ClaimsRepository(db).effective_user_ids(user_id=user.id)
        people = {self.idx.person_of(a) for a in accounts}
        self.accounts, self.people = set(accounts), people
        self.read: set[str] = set().union(*(self.idx.by_person.get(p, set()) for p in people)) if people else set()

        # marks, newest first, one per book
        self.marks: list[tuple[str, BookReview]] = []
        seen: set[str] = set()
        rows = db.execute(
            select(BookReview).where(BookReview.user_id.in_(list(accounts))).order_by(BookReview.updated_at.desc())
        ).scalars()
        for r in rows:
            work = self.idx.find(r.work_key)
            key = work.key if work else r.work_key
            if key in seen:
                continue
            seen.add(key)
            self.marks.append((key, r))
            self.read.add(key)

        marked = {k for k, _ in self.marks}
        finished = [b for b in _shelf(db, user).books if b.status == "finished"]
        finished.sort(key=lambda b: b.finished_on or "", reverse=True)
        self.recent: list[str] = []
        for b in finished:
            work = self.idx.find(b.work_key) or self.idx.find(b.match_key) or self.idx.find(catalog.work_key(b.title))
            if work is not None and work.key in marked:
                continue
            self.recent.append(b.title)
            if len(self.recent) >= 15:
                break

        # a newcomer's first step: their three favourite books (the profile's «Любимые книги»)
        self.favourites: list[str] = [t for t in (user.favorite_books or []) if t and t.strip()][:3]
        self.favourite_keys: set[str] = set()
        for title in self.favourites:
            work = book_face.work_of(self.idx, title=title)
            if work is not None:
                self.read.add(work.key)
                self.favourite_keys.add(work.key)

        # minutes a reading day lately, for «≈ N дней при ваших M мин в день»
        from app.repositories.insights import InsightsRepository

        since = date.today() - timedelta(days=60)
        days: dict[date, int] = {}
        for d, m in InsightsRepository(db).daily_minutes_all_time(user_ids=list(accounts)):
            if d >= since and m > 0:
                days[d] = days.get(d, 0) + m
        self.pace = round(sum(days.values()) / len(days)) if len(days) >= 3 else None

        self.wanted = want.mine(db, user.id)
        self.want_keys = {w.work_key for w in self.wanted if w.work_key}
        self.dismissed = list(
            db.execute(select(BookDismissal).where(BookDismissal.user_id == user.id).order_by(BookDismissal.created_at.desc())).scalars()
        )
        self.dismissed_keys = set()
        for d in self.dismissed:
            work = self.idx.find(d.work_key)
            self.dismissed_keys.add(work.key if work else d.work_key)
        self.want_norms = {want._norm(w.title): w.id for w in self.wanted}

        # everyone's high marks, to give each pick a person: who in the club loved it, and what of yours they loved too
        self.loved: dict[str, list[tuple[uuid.UUID, int]]] = {}
        mine_people = people
        for account, key, rating in db.execute(
            select(BookReview.user_id, BookReview.work_key, BookReview.rating).where(BookReview.rating >= LOVED)
        ).all():
            work = self.idx.find(key)
            person = self.idx.person_of(account)
            if work is None or person in mine_people:
                continue
            self.loved.setdefault(work.key, []).append((account, rating))
        self.names = {
            u.id: (u.display_name, u.gender.value if u.gender else None)
            for u in db.execute(select(User).where(User.is_claimable.is_(False))).scalars()
        }
        my_loved = {k: r for k, r in self.marks if r.rating >= LOVED}
        # account -> a book both loved, with both marks
        self.shared_love: dict[uuid.UUID, tuple[str, int, int]] = {}
        for key, review in my_loved.items():
            for account, rating in self.loved.get(key, []):
                if account not in self.shared_love or rating > self.shared_love[account][2]:
                    self.shared_love[account] = (review.title, review.rating, rating)

        topics: Counter[str] = Counter()
        rating = {k: r.rating for k, r in self.marks}
        for key in self.read:
            fact = self.facts.get(key)
            if fact and fact.topics:
                topics[fact.topics[0]] += max(0.2, 1 + (rating.get(key, 7) - 6) / 4)
        self.topics = [t for t, _ in topics.most_common(4)]

    def has_taste(self) -> bool:
        """Enough to go on: three books known — marked, finished or named a favourite (the dry run of 21.10: most
        readers finish books in the circles and mark none, and fifteen finished books say plenty)."""
        return len(self.marks) + len(self.recent) + len(self.favourites) >= MIN_KNOWN

    def marks_missing(self) -> int:
        return max(0, MIN_KNOWN - len(self.marks) - len(self.recent) - len(self.favourites))

    def known_titles(self) -> list[str]:
        """Every book the reader's taste names: a «why» may quote these and the candidates, nothing else."""
        return (
            [r.title for _, r in self.marks] + self.recent + self.favourites
            + [w.title for w in self.wanted] + [d.title for d in self.dismissed]
        )

    def taste(self) -> dict:
        return {
            "marks": [
                {"title": r.title, "author": r.author, "mark": r.rating, "their_words": _cut(r.text, 300)}
                for _, r in self.marks[:40]
            ],
            "read_lately_unmarked": self.recent,
            "favourite_books": self.favourites,
            "want_to_read": [w.title for w in self.wanted[:20]],
            "not_for_me": [d.title for d in self.dismissed[:30]],
            "favourite_topics": self.topics,
        }

    def loved_by(self, key: str) -> list[dict]:
        """Up to two club members who marked this book high, those who also loved a book of the reader's first."""
        out = []
        fans = sorted(self.loved.get(key, []), key=lambda ar: (ar[0] not in self.shared_love, -ar[1]))
        for account, rating in fans:
            name, gender = self.names.get(account, (None, None))
            if not name:
                continue
            # their gender, so «поставила» / «поставил» is right
            entry = {"name": name, "gender": gender, "mark": rating}
            if account in self.shared_love:
                title, _, theirs = self.shared_love[account]
                entry["also_loved_your"] = {"title": title, "their_mark": theirs}
            out.append(entry)
            if len(out) == 2:
                break
        return out

    def out(self, key: str) -> bool:
        return key in self.read or key in self.want_keys or key in self.dismissed_keys or key not in self.idx.works


def _hash(lang: str, taste: dict) -> str:
    raw = json.dumps({"lang": lang, "model": llm.model_name(), "taste": taste}, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _current(db: Session, user: User, lang: str) -> AiDigest | None:
    return db.execute(
        select(AiDigest)
        .where(AiDigest.user_id == user.id, AiDigest.kind == KIND, AiDigest.scope == SCOPE, AiDigest.lang == lang)
        .order_by(AiDigest.updated_at.desc())
    ).scalars().first()


def _wish(text: str | None) -> str | None:
    text = " ".join((text or "").split())[:WISH_CHARS]
    return text or None


def get(db: Session, *, user: User, lang: str) -> PicksOut:
    from app.services.reading_ai import _is_abandoned

    if lang not in _LANG_NAMES:
        raise _bad("bad_lang")
    on = enabled_for(user)
    if not on:
        return PicksOut(enabled=False, ai_available=False, has_taste=False, status=None)
    reader = _Reader(db, user)
    row = _current(db, user, lang)
    out = PicksOut(
        enabled=True, ai_available=llm.available(), has_taste=reader.has_taste(), marks_missing=reader.marks_missing(), status=None
    )
    if row is None:
        return out
    out.status, out.error, out.updated_at = row.status, row.error, row.updated_at
    if row.status == "working" and _is_abandoned(row):
        out.status, out.error = "error", "interrupted"
    content = row.content or {}
    out.taste = content.get("taste")
    out.wish = content.get("wish")
    # changed since: the same ask on the taste there is now would be another one
    out.stale = row.status == "done" and row.input_hash != _hash(lang, {**reader.taste(), "wish": out.wish})

    from app.services import want

    marks = books_service._marks(db, reader.idx)
    sale = books_service._for_sale(db, reader.idx)
    want_ids = {w.work_key: w.id for w in reader.wanted if w.work_key}
    for p in content.get("picks", []):
        found = p.get("outside")
        if found:
            norm = want._norm(found["title"])
            work = book_face.work_of(reader.idx, title=found["title"])
            if (work is not None and work.key in reader.read) or OUTSIDE_PREFIX + norm in reader.dismissed_keys:
                continue
            cover, thumb = book_face.cover_urls(found.get("image"))
            book = CatalogItemOut(
                key=OUTSIDE_PREFIX + norm, title=found["title"], author=found.get("author"), cover_url=cover,
                cover_thumb_url=thumb, readers=0, pb_rating=None, pb_votes=0, pb_reviews=0, ext_rating=None,
                ext_scale=5, ext_votes=None, ext_source=None, for_sale=0, my_rating=None, topics=[],
            )
            out.picks.append(
                PickOut(
                    book=book, why=p.get("why") or "", want_id=reader.want_norms.get(norm), outside=True,
                    link=found.get("link"), buy_url=_buy_url(found["title"]),
                )
            )
            continue
        work = reader.idx.find(p.get("key"))
        if work is None or work.key in reader.read or work.key in reader.dismissed_keys:
            continue
        fact = reader.facts.get(work.key)
        item = books_service._item(work, marks.get(work.key), fact, sale.get(work.key, 0), None)
        out.picks.append(
            PickOut(
                book=CatalogItemOut.model_validate(item.model_dump()), why=p.get("why") or "",
                want_id=want_ids.get(work.key) or reader.want_norms.get(want._norm(work.title)),
                buy_url=_buy_url(work.title), days=_days(fact.pages if fact else None, reader.pace),
                match=p.get("match"), fits=list(p.get("fits") or []),
            )
        )
    out.pace = reader.pace
    # the reader's taste, said plainly at the top of the page
    from app.services.taste import Taste

    taste = Taste(db, reader)
    out.likes, out.dislikes = taste.likes(4), taste.dislikes(2)
    return out


# A book from the world is no work of the library: its key in «Не моё» and on the page is this and its title.
OUTSIDE_PREFIX = "x:"


def _buy_url(title: str) -> str:
    """Where to get it in Kazakhstan: the book's search on Flip.kz."""
    from urllib.parse import quote

    return f"https://www.flip.kz/search?search={quote(title)}"


def _days(pages: int | None, pace: int | None) -> int | None:
    """Days to read it at the reader's own pace (minutes a reading day lately), when both are known."""
    if not pages or not pace:
        return None
    return max(1, math.ceil(pages * MINUTES_A_PAGE / pace))


def start(
    db: Session, *, user: User, lang: str, force: bool = False, notify_title: str | None = None, wish: str | None = None,
    keep_wish: bool = False,
) -> PicksOut:
    """Write the picks in the background (the page polls get()). Fresh picks for the same taste and ask are kept,
    unless the reader asks for others (force). `wish` is the reader's own ask; written again by itself (keep_wish),
    the last ask stays."""
    from app.services.reading_ai import _DAILY_LIMIT, _is_abandoned

    if lang not in _LANG_NAMES:
        raise _bad("bad_lang")
    if not enabled_for(user):
        raise _bad("not_found", status.HTTP_404_NOT_FOUND)
    if not llm.available():
        raise _bad("ai_off", status.HTTP_503_SERVICE_UNAVAILABLE)
    reader = _Reader(db, user)
    if not reader.has_taste():
        raise _bad("nothing_to_go_on")
    row = _current(db, user, lang)
    if keep_wish and row is not None:
        wish = (row.content or {}).get("wish")
    wish = _wish(wish)
    taste = {**reader.taste(), "wish": wish}
    digest_hash = _hash(lang, taste)
    now = datetime.now(timezone.utc)
    if row is not None:
        if row.status == "working" and not _is_abandoned(row):
            return get(db, user=user, lang=lang)
        if row.status == "done" and row.input_hash == digest_hash and not force:
            return get(db, user=user, lang=lang)

    recent = db.execute(
        select(func.count()).where(AiDigest.user_id == user.id, AiDigest.updated_at > now - timedelta(days=1))
    ).scalar_one()
    if recent >= _DAILY_LIMIT:
        raise _bad("ai_daily_limit", status.HTTP_429_TOO_MANY_REQUESTS)

    shown = {p.get("key") for p in ((row.content or {}).get("picks", []) if row is not None and force else [])}
    payload, ids = _prepare(db, user, reader, lang, shown)

    if row is None:
        row = AiDigest(user_id=user.id, kind=KIND, scope=SCOPE, lang=lang, input_hash=digest_hash, status="working")
        db.add(row)
    else:
        row.status, row.input_hash, row.error = "working", digest_hash, None
        row.updated_at = now
    db.commit()
    db.refresh(row)
    if wish:
        payload["reader"]["wish"] = wish
    threading.Thread(target=_write, args=(row.id, lang, payload, ids, notify_title, wish), daemon=True).start()
    return get(db, user=user, lang=lang)


def _prepare(db: Session, user: User, reader: _Reader, lang: str, shown: set[str] = frozenset()) -> tuple[dict, dict[str, str]]:
    """What the AI is asked: the reader's taste and the candidates by short id (and the ids, to map back). Keys
    starting with "_" stay here: they check the answer and are never sent."""
    from app.services import want

    from app.services.taste import Taste

    taste = Taste(db, reader)
    # every book of the library the reader does not know yet, ranked by how it fits them, varied
    pool = [k for k in reader.idx.works if not reader.out(k)]
    ranked = taste.rank(pool, CANDIDATES)
    ids = {f"b{i + 1}": f.key for i, f in enumerate(ranked)}
    fit_of = {f.key: f for f in ranked}
    # «Другие варианты»: the books shown now go to the end of the list, so others come first
    order = sorted(ids.items(), key=lambda kv: kv[1] in shown)
    candidates = []
    for cid, key in order:
        work = reader.idx.works[key]
        fact = reader.facts.get(key)
        f = fit_of[key]
        dna = taste.dna.get(key)
        candidates.append(
            {
                "id": cid,
                "title": work.title,
                "author": work.author,
                "year": fact.year if fact else None,
                "essence": dna.essence if dna else None,
                "about": None if dna and dna.essence else _about(fact, lang),
                # how well it fits the reader's taste, and by what
                "match_percent": f.match,
                "fits_their_taste": [_said(t) for t in f.fits],
                "against_their_taste": [_said(t) for t in f.clashes],
                "pb_readers": len(work.readers),
                "loved_by": taste.kindred_fans(key, reader.names) or reader.loved_by(key),
            }
        )
    # for the outside books: what the reader knows (never named again) and the club's books (named, they are club picks)
    club = {
        want._norm(w.title): w.key for w in reader.idx.works.values() if not reader.out(w.key)
    }
    portrait = {"likes": [_said(t) for t in taste.likes()], "dislikes": [_said(t) for t in taste.dislikes()]}
    payload = {
        "reader": {**reader.taste(), "portrait": portrait, "_known": reader.known_titles()},
        "candidates": candidates,
        "_fit": {cid: {"match": fit_of[key].match, "fits": fit_of[key].fits} for cid, key in ids.items()},
        "_skip": sorted({want._norm(t) for t in reader.known_titles()}),
        "_club": club,
    }
    return payload, ids


def _said(trait: str) -> str:
    """A trait as plain English words for the AI: "mood:warm" → "warm mood", "themes:coming_of_age" → "about coming of
    age" (it writes them in the reader's language; the codes never reach a reader)."""
    group, _, word = trait.partition(":")
    word = word.replace("_", " ")
    return {
        "mood": f"{word} mood", "pace": f"{word} pace", "length": f"{word} length", "themes": f"about {word}",
        "form": f"{word} (form)", "style": f"{word} style", "era": f"{word} era", "ease": f"{word} to read",
    }.get(group, word)


# The trait words in English: in a Russian or Kazakh «why» they are a code that slipped through.
_CODES = {w for words in book_dna.VOCAB.values() for w in words if len(w) > 4}


def _speaks_codes(text: str, lang: str) -> bool:
    if lang == "en":
        return False
    # a title in «…» may be English («The Power of Habit»): only the words around it count
    bare = re.sub(r"«[^»]*»", " ", text or "")
    return any(w in _CODES for w in re.findall(r"[a-z_]+", bare.casefold()))


def _words(text: str) -> list[str]:
    return re.findall(r"\w+", text.casefold().replace("ё", "е"))


def _same_word(a: str, b: str) -> bool:
    """One word, declined or not: «трём» and «три», «товарищам» and «товарища»."""
    if a == b:
        return True
    n = 0
    while n < min(len(a), len(b)) and a[n] == b[n]:
        n += 1
    return n >= 2 and n >= min(len(a), len(b)) - 2


def _names(quoted: str, title: str) -> bool:
    q, t = _words(quoted), _words(title)
    return bool(q) and all(any(_same_word(w, v) for v in t) for w in q)


def _holds(why: str, known: list[str]) -> bool:
    """Every book a «why» quotes («…») is one the reader really marked, read or turned down, or a candidate: the AI
    may not tell a reader they gave 9 to a book they never had."""
    return all(any(_names(quoted, k) for k in known) for quoted in re.findall(r"«([^»]{1,120})»", why))


def choose(payload: dict, ids: dict[str, str], lang: str, *, look_up=None) -> dict:
    """Ask the AI, and keep only what holds: club candidates by their ids, outside books a catalogue really has, once
    each, whose «why» quotes no book the reader never had. Two from the club and one from the world when there are.
    {"taste", "picks": [{"key", "why"} | {"key": None, "outside": {...}, "why"}], "dropped": n}"""
    from app.services import book_lookup, want

    look_up = look_up or book_lookup.find
    known = list(payload["reader"].get("_known", []))
    for c in payload["candidates"]:
        known.append(c["title"])
        known.extend(f["also_loved_your"]["title"] for f in c.get("loved_by", []) if f.get("also_loved_your"))
    asked = {
        "reader": {k: v for k, v in payload["reader"].items() if not k.startswith("_")},
        "candidates": payload["candidates"],
    }
    answer = llm.ask_json(
        system=_SYSTEM.format(n=ASK, m=OUTSIDE, lang=_LANG_NAMES[lang]),
        prompt=json.dumps(asked, ensure_ascii=False, default=str),
        schema=_SCHEMA,
        max_tokens=3500,
    )
    club, seen, dropped = [], set(), 0
    for p in answer.get("picks", []):
        key = ids.get(str(p.get("id", "")).strip())
        why = str(p.get("why", "")).strip()
        if key and key not in seen and why and _holds(why, known) and not _speaks_codes(why, lang):
            seen.add(key)
            club.append({"key": key, "why": why, **payload.get("_fit", {}).get(str(p.get("id", "")).strip(), {})})
        else:
            dropped += 1

    world, skip, lookups = [], set(payload.get("_skip", [])), 0
    club_by_title = payload.get("_club", {})
    for p in answer.get("outside", []):
        title, author = str(p.get("title", "")).strip(), str(p.get("author", "")).strip() or None
        why = str(p.get("why", "")).strip()
        norm = want._norm(title) if title else ""
        if not title or not why or norm in skip or not _holds(why, known + [title]) or _speaks_codes(why, lang):
            dropped += 1
            continue
        # a book of the club after all: a club pick, with its face and its readers
        key = club_by_title.get(norm)
        if key:
            if key not in seen:
                seen.add(key)
                club.append({"key": key, "why": why})
            continue
        if lookups >= OUTSIDE_LOOKUPS or len(world) >= PICKS:
            continue
        lookups += 1
        found = look_up(title, author)
        if found is None:
            dropped += 1
            continue
        skip.add(norm)
        world.append({
            "key": None,
            "why": why,
            "outside": {"title": found.title, "author": found.author, "image": found.image, "link": found.link, "source": found.source},
        })

    from_club = min(FROM_CLUB, len(club))
    picks = club[:from_club] + world[: PICKS - from_club]
    rest = club[from_club:] + world[PICKS - from_club :]
    picks += rest[: PICKS - len(picks)]
    if not picks:
        raise ValueError("no book among the picks")
    taste_line = str(answer.get("taste", "")).strip()
    if _speaks_codes(taste_line, lang):
        taste_line = ""
    return {"taste": taste_line, "picks": picks[:PICKS], "dropped": dropped}


def _write(
    digest_id: uuid.UUID, lang: str, payload: dict, ids: dict[str, str], notify_title: str | None, wish: str | None = None
) -> None:
    from app.db.session import get_session_factory
    from app.services import notify

    db = get_session_factory()()
    try:
        row = db.get(AiDigest, digest_id)
        if row is None:
            return
        try:
            row.content = {**choose(payload, ids, lang), "wish": wish}
            row.status, row.error = "done", None
            picks = row.content["picks"]
            if notify_title and AUTO_BELL:
                notify.notify(db, row.user_id, "picks", {"title": notify_title, "n": len(picks[:PICKS])}, dedupe="picks")
        except llm.AiUnavailable:
            row.status, row.error = "error", "ai_unavailable"
        except llm.AiRefused:
            row.status, row.error = "error", "ai_refused"
        except Exception as exc:
            logger.exception("picks %s failed", digest_id)
            row.status, row.error = "error", str(exc)[:300] or "failed"
        db.commit()
    finally:
        db.close()


def _dismiss_key(db: Session, work_key: str | None, title: str | None) -> tuple[str, str, str | None]:
    """(key, title, author) of a book turned down: the library's work, or a book from the world by its title."""
    from app.services import want

    if work_key and not work_key.startswith(OUTSIDE_PREFIX):
        work = catalog.index(db).find(work_key)
        if work is None:
            raise _bad("book_not_found", status.HTTP_404_NOT_FOUND)
        return work.key, work.title, work.author
    if not title or not title.strip():
        raise _bad("title_required")
    return OUTSIDE_PREFIX + want._norm(title), title.strip(), None


def dismiss(db: Session, *, user: User, work_key: str | None, title: str | None = None, author: str | None = None) -> None:
    """«Не моё»: never suggested again, and the next picks know it."""
    key, name, by = _dismiss_key(db, work_key, title)
    by = by or (author or "").strip() or None
    row = db.execute(
        select(BookDismissal).where(BookDismissal.user_id == user.id, BookDismissal.work_key == key)
    ).scalar_one_or_none()
    if row is None:
        db.add(BookDismissal(user_id=user.id, work_key=key[:300], title=name[:300], author=by[:200] if by else None))
        db.commit()


def undismiss(db: Session, *, user: User, work_key: str | None, title: str | None = None) -> None:
    try:
        key = _dismiss_key(db, work_key, title)[0]
    except HTTPException:
        key = work_key or ""
    row = db.execute(select(BookDismissal).where(BookDismissal.user_id == user.id, BookDismissal.work_key == key)).scalar_one_or_none()
    if row is not None:
        db.delete(row)
        db.commit()


def after_mark(db: Session, user: User, review: BookReview) -> None:
    """A book the reader loved: the moment to say what next. Fresh picks in the background, then the bell.
    Never in the way of saving the mark."""
    try:
        if review.rating < LOVED or not enabled_for(user) or not llm.available():
            return
        # in the language the reader last read their picks in
        last = db.execute(
            select(AiDigest.lang).where(AiDigest.user_id == user.id, AiDigest.kind == KIND).order_by(AiDigest.updated_at.desc())
        ).scalars().first()
        lang = last or "ru"
        row = _current(db, user, lang)
        if row is not None and row.updated_at:
            updated = row.updated_at if row.updated_at.tzinfo else row.updated_at.replace(tzinfo=timezone.utc)
            if updated > datetime.now(timezone.utc) - AUTO_EVERY:
                return
        start(db, user=user, lang=lang, notify_title=review.title)
    except HTTPException:
        pass
    except Exception:
        logger.exception("picks after a mark failed")
        db.rollback()
