"""«Что почитать дальше»: the AI librarian.

The founder (2026-10-21): from a reader's marks, the AI suggests what to read next and says why, and one tap puts a
book on «Хочу прочитать». A free test for the readers there are now; later a paid feature for new ones.

How it picks, so it never names a book that does not exist:

1. Candidates come from the shared library only, the books PowerBook readers actually read: what readers with
   shelves like yours read (reading_ai.recommendations), the best-rated books of your favourite topics, and more of
   the authors you loved. Read, wanted and turned-down books are left out.
2. The AI (llm.py: DeepSeek or Claude) gets the reader's taste (marks with their words, recent books, «Хочу
   прочитать», «Не моё», topics) and the candidates by short id, chooses five and writes why each one, in the
   reader's language. An id that is not a candidate is dropped.
3. What it learns from: every new mark, «Хочу прочитать» and «Не моё» change the taste, and the picks are written
   again the next time they are opened.

It also comes by itself: a mark of 8 and up writes fresh picks in the background and the bell says so (at most
once a day, «Что почитать дальше» in the bell's switches).
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
from datetime import datetime, timedelta, timezone

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
from app.services import catalog, llm

logger = logging.getLogger(__name__)

# While False only admins see it (and get it by themselves); the founder flips it for everyone.
FOR_EVERYONE = False

KIND = "picks"
SCOPE = "next"
PICKS = 3
# Asked for a few more than shown, so a pick whose «why» does not hold up can be dropped.
ASK = 5
# Fewer books known than this (marked, or finished without a mark): no picks yet, the reader is asked to mark a few
# books first (council 2026-10-21: weak picks on a first look are worse than none).
MIN_KNOWN = 3
# A thinner choice than this is no choice: nothing is picked.
MIN_CANDIDATES = 8
CANDIDATES = 60
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
    "list of candidate books from the community's library, each with an id. Choose exactly {n} candidates for this "
    "reader: the ones that follow best from what they marked high, unlike what they marked low or turned down. "
    "Vary them: not all one author or one topic, and one may be a little outside their habit if their marks point "
    "there. For each, say why in one or two short sentences, speaking to the reader directly. The best reason is a "
    "person: when a candidate has `loved_by` (club members who marked it high, and the book of the reader's they also "
    "loved), lead with that person by name («Айгерим тоже поставила 9 «Трём товарищам» — а этой книге 10»); "
    "otherwise name the reader's own books («you gave 9 to …»). Use only what the candidate data and the reader's words say; never invent plot, "
    "awards or facts. Choose only from the candidates, by their ids. Also write one short line that sums up their "
    "taste as you see it. Write everything in {lang}, plainly, no flattery."
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
    },
    "required": ["taste", "picks"],
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

        self.wanted = want.mine(db, user.id)
        self.want_keys = {w.work_key for w in self.wanted if w.work_key}
        self.dismissed = list(
            db.execute(select(BookDismissal).where(BookDismissal.user_id == user.id).order_by(BookDismissal.created_at.desc())).scalars()
        )
        self.dismissed_keys = set()
        for d in self.dismissed:
            work = self.idx.find(d.work_key)
            self.dismissed_keys.add(work.key if work else d.work_key)

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
        self.names = {u.id: u.display_name for u in db.execute(select(User).where(User.is_claimable.is_(False))).scalars()}
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
        return bool(self.marks) and len(self.marks) + len(self.recent) >= MIN_KNOWN

    def marks_missing(self) -> int:
        return 0 if self.has_taste() else max(1, MIN_KNOWN - len(self.marks) - len(self.recent))

    def known_titles(self) -> list[str]:
        """Every book the reader's taste names: a «why» may quote these and the candidates, nothing else."""
        return [r.title for _, r in self.marks] + self.recent + [w.title for w in self.wanted] + [d.title for d in self.dismissed]

    def taste(self) -> dict:
        return {
            "marks": [
                {"title": r.title, "author": r.author, "mark": r.rating, "their_words": _cut(r.text, 300)}
                for _, r in self.marks[:40]
            ],
            "read_lately_unmarked": self.recent,
            "want_to_read": [w.title for w in self.wanted[:20]],
            "not_for_me": [d.title for d in self.dismissed[:30]],
            "favourite_topics": self.topics,
        }

    def loved_by(self, key: str) -> list[dict]:
        """Up to two club members who marked this book high, those who also loved a book of the reader's first."""
        out = []
        fans = sorted(self.loved.get(key, []), key=lambda ar: (ar[0] not in self.shared_love, -ar[1]))
        for account, rating in fans:
            name = self.names.get(account)
            if not name:
                continue
            entry = {"name": name, "mark": rating}
            if account in self.shared_love:
                title, _, theirs = self.shared_love[account]
                entry["also_loved_your"] = {"title": title, "their_mark": theirs}
            out.append(entry)
            if len(out) == 2:
                break
        return out

    def out(self, key: str) -> bool:
        return key in self.read or key in self.want_keys or key in self.dismissed_keys or key not in self.idx.works

    def candidates(self, db: Session, user: User) -> list[str]:
        from app.services.reading_ai import recommendations

        marks = books_service._marks(db, self.idx)
        picked: list[str] = []

        def take(key: str) -> None:
            if key not in picked and not self.out(key):
                picked.append(key)

        # 0. what the readers who loved your books loved
        if self.shared_love:
            kin = set(self.shared_love)
            theirs = [k for k, fans in self.loved.items() if any(a in kin for a, _ in fans)]
            for key in sorted(theirs, key=lambda k: -max(r for a, r in self.loved[k] if a in kin))[:20]:
                take(key)

        # 1. readers whose shelves look like yours (or the club's best, with nothing to go on)
        for rec in recommendations(db, user=user, limit=40):
            take(rec.book.key)

        def quality(key: str) -> float:
            work = self.idx.works[key]
            q = math.log1p(len(work.readers)) / 2
            if key in marks:
                q += marks[key].weighted / 10
            fact = self.facts.get(key)
            if fact is not None and fact.rating is not None:
                q += float(fact.rating) / float(fact.rating_scale or 5)
            return q

        # 2. more of the authors the reader loved
        loved_authors = {(r.author or "").casefold() for _, r in self.marks if r.rating >= LOVED and r.author}
        if loved_authors:
            same = [k for k, w in self.idx.works.items() if (w.author or "").casefold() in loved_authors]
            for key in sorted(same, key=quality, reverse=True)[:12]:
                take(key)

        # 3. the best of their favourite topics
        if self.topics:
            near = [k for k, f in self.facts.items() if f.topics and set(f.topics) & set(self.topics) and k in self.idx.works]
            for key in sorted(near, key=quality, reverse=True)[:40]:
                take(key)
        return picked[:CANDIDATES]


def _hash(lang: str, taste: dict) -> str:
    raw = json.dumps({"lang": lang, "model": llm.model_name(), "taste": taste}, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _current(db: Session, user: User, lang: str) -> AiDigest | None:
    return db.execute(
        select(AiDigest)
        .where(AiDigest.user_id == user.id, AiDigest.kind == KIND, AiDigest.scope == SCOPE, AiDigest.lang == lang)
        .order_by(AiDigest.updated_at.desc())
    ).scalars().first()


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
    out.stale = row.status == "done" and row.input_hash != _hash(lang, reader.taste())

    marks = books_service._marks(db, reader.idx)
    sale = books_service._for_sale(db, reader.idx)
    want_ids = {w.work_key: w.id for w in reader.wanted if w.work_key}
    for p in content.get("picks", []):
        work = reader.idx.find(p.get("key"))
        if work is None or work.key in reader.read or work.key in reader.dismissed_keys:
            continue
        item = books_service._item(work, marks.get(work.key), reader.facts.get(work.key), sale.get(work.key, 0), None)
        out.picks.append(
            PickOut(book=CatalogItemOut.model_validate(item.model_dump()), why=p.get("why") or "", want_id=want_ids.get(work.key))
        )
    return out


def start(db: Session, *, user: User, lang: str, force: bool = False, notify_title: str | None = None) -> PicksOut:
    """Write the picks in the background (the page polls get()). Fresh picks for the same taste are kept, unless
    the reader asks for others (force)."""
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
    taste = reader.taste()
    digest_hash = _hash(lang, taste)
    row = _current(db, user, lang)
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
    if len(ids) < MIN_CANDIDATES:
        raise _bad("nothing_to_go_on")

    if row is None:
        row = AiDigest(user_id=user.id, kind=KIND, scope=SCOPE, lang=lang, input_hash=digest_hash, status="working")
        db.add(row)
    else:
        row.status, row.input_hash, row.error = "working", digest_hash, None
        row.updated_at = now
    db.commit()
    db.refresh(row)
    threading.Thread(target=_write, args=(row.id, lang, payload, ids, notify_title), daemon=True).start()
    return get(db, user=user, lang=lang)


def _prepare(db: Session, user: User, reader: _Reader, lang: str, shown: set[str] = frozenset()) -> tuple[dict, dict[str, str]]:
    """What the AI is asked: the reader's taste and the candidates by short id (and the ids, to map back)."""
    keys = reader.candidates(db, user)
    ids = {f"b{i + 1}": key for i, key in enumerate(keys)}
    # «Другие варианты»: the books shown now go to the end of the list, so others come first
    order = sorted(ids.items(), key=lambda kv: kv[1] in shown)
    candidates = []
    for cid, key in order:
        work = reader.idx.works[key]
        fact = reader.facts.get(key)
        candidates.append(
            {
                "id": cid,
                "title": work.title,
                "author": work.author,
                "topics": list(fact.topics or [])[:3] if fact else [],
                "year": fact.year if fact else None,
                "about": _about(fact, lang),
                "pb_readers": len(work.readers),
                "loved_by": reader.loved_by(key),
            }
        )
    return {"reader": {**reader.taste(), "_known": reader.known_titles()}, "candidates": candidates}, ids


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


def choose(payload: dict, ids: dict[str, str], lang: str) -> dict:
    """Ask the AI, and keep only what holds: candidates by their ids, once each, whose «why» quotes no book the reader
    never had. {"taste", "picks": [{"key", "why"}], "dropped": n}"""
    known = list(payload["reader"].get("_known", []))
    for c in payload["candidates"]:
        known.append(c["title"])
        known.extend(f["also_loved_your"]["title"] for f in c.get("loved_by", []) if f.get("also_loved_your"))
    asked = {**payload, "reader": {k: v for k, v in payload["reader"].items() if k != "_known"}}
    answer = llm.ask_json(
        system=_SYSTEM.format(n=ASK, lang=_LANG_NAMES[lang]),
        prompt=json.dumps(asked, ensure_ascii=False, default=str),
        schema=_SCHEMA,
        max_tokens=3000,
    )
    picks, seen, dropped = [], set(), 0
    for p in answer.get("picks", []):
        key = ids.get(str(p.get("id", "")).strip())
        why = str(p.get("why", "")).strip()
        if key and key not in seen and why and _holds(why, known):
            seen.add(key)
            picks.append({"key": key, "why": why})
        else:
            dropped += 1
    if not picks:
        raise ValueError("no candidate among the picks")
    return {"taste": str(answer.get("taste", "")).strip(), "picks": picks[:PICKS], "dropped": dropped}


def _write(digest_id: uuid.UUID, lang: str, payload: dict, ids: dict[str, str], notify_title: str | None) -> None:
    from app.db.session import get_session_factory
    from app.services import notify

    db = get_session_factory()()
    try:
        row = db.get(AiDigest, digest_id)
        if row is None:
            return
        try:
            row.content = choose(payload, ids, lang)
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


def dismiss(db: Session, *, user: User, work_key: str) -> None:
    """«Не моё»: never suggested again, and the next picks know it."""
    work = catalog.index(db).find(work_key)
    if work is None:
        raise _bad("book_not_found", status.HTTP_404_NOT_FOUND)
    row = db.execute(
        select(BookDismissal).where(BookDismissal.user_id == user.id, BookDismissal.work_key == work.key)
    ).scalar_one_or_none()
    if row is None:
        db.add(BookDismissal(user_id=user.id, work_key=work.key, title=work.title[:300], author=(work.author or None) and work.author[:200]))
        db.commit()


def undismiss(db: Session, *, user: User, work_key: str) -> None:
    work = catalog.index(db).find(work_key)
    key = work.key if work else work_key
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
