"""A reader's reading, looked back on: a month, a year or all of it.

Three parts work with no AI at all — the numbers and topics of a period,
books suggested by readers whose shelves look like yours, and every note
the reader wrote gathered by book. The fourth is Claude's: a letter about
a period (what the reader read, what drew them, what their notes keep
coming back to, what to read next), or one book's notes drawn together
into its main ideas. That part needs the Anthropic key on the server and
is written on request, in the background, and kept.
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import threading
import uuid
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.ai_digest import AiDigest
from app.models.user import User
from app.repositories.claims import ClaimsRepository
from app.repositories.insights import InsightsRepository
from app.schemas.books import CatalogItemOut
from app.schemas.library import BookcaseBookOut
from app.schemas.reading_ai import (
    AuthorCountOut,
    BestDayOut,
    DigestOut,
    NotebookEntryOut,
    NoteOut,
    PeriodBookOut,
    ReadingOverviewOut,
    RecommendationOut,
    TopicShareOut,
    UnitOut,
)
from app.services import books as books_service
from app.services import catalog, claude
from app.services.catalog import CatalogIndex

logger = logging.getLogger(__name__)

_DAILY_LIMIT = 20
_LANG_NAMES = {"ru": "Russian", "kk": "Kazakh", "en": "English"}


def _bad(detail: str, code: int = status.HTTP_400_BAD_REQUEST) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


def _parse_period(period: str) -> tuple[int | None, int | None]:
    if period == "all":
        return None, None
    try:
        if len(period) == 4:
            return int(period), None
        if len(period) == 7 and period[4] == "-":
            year, month = int(period[:4]), int(period[5:])
            if 1 <= month <= 12:
                return year, month
    except ValueError:
        pass
    raise _bad("bad_period")


def _in_period(iso: str | None, year: int | None, month: int | None) -> bool:
    if year is None:
        return True
    if not iso:
        return False
    if int(iso[:4]) != year:
        return False
    return month is None or int(iso[5:7]) == month


def _shelf(db: Session, user: User):
    from app.services.bookcase import BookcaseService

    return BookcaseService(db).bookcase(owner_id=user.id, viewer_id=user.id)


def _work_of(idx: CatalogIndex, vol: BookcaseBookOut):
    return idx.find(vol.match_key) or idx.find(catalog.work_key(vol.title))


def _streak(days: list[date]) -> int:
    best = run = 0
    previous = None
    for d in sorted(set(days)):
        run = run + 1 if previous is not None and d - previous == timedelta(days=1) else 1
        best = max(best, run)
        previous = d
    return best


def overview(db: Session, *, user: User, period: str) -> ReadingOverviewOut:
    year, month = _parse_period(period)
    shelf = _shelf(db, user)
    idx = catalog.index(db)
    facts = books_service.facts_by_work(db, idx)
    reviews = {r.volume_key: r for r in books_service.reviews_for_shelf(db, user.id) if r.volume_key}

    ids = ClaimsRepository(db).effective_user_ids(user_id=user.id)
    daily: dict[date, int] = defaultdict(int)
    for d, m in InsightsRepository(db).daily_minutes_all_time(user_ids=ids):
        daily[d] += m

    finished = [b for b in shelf.books if b.status == "finished"]
    years = sorted({d.year for d, m in daily.items() if m > 0} | {int(b.finished_on[:4]) for b in finished if b.finished_on})
    months: list[int] = []
    if year is not None:
        months = sorted(
            {d.month for d, m in daily.items() if m > 0 and d.year == year}
            | {int(b.finished_on[5:7]) for b in finished if b.finished_on and int(b.finished_on[:4]) == year}
        )

    in_books = [b for b in finished if _in_period(b.finished_on, year, month)]
    in_days = {d: m for d, m in daily.items() if m > 0 and _in_period(d.isoformat(), year, month)}

    notes_count = 0
    for b in shelf.books:
        for n in b.notes:
            if _in_period(n.created_at.date().isoformat(), year, month):
                notes_count += 1

    book_rows: list[PeriodBookOut] = []
    topic_counts: Counter[str] = Counter()
    author_counts: Counter[str] = Counter()
    ratings: list[int] = []
    for b in in_books:
        work = _work_of(idx, b)
        fact = facts.get(work.key) if work else None
        book_topics = list(fact.topics or []) if fact else []
        topic_counts.update(book_topics)
        if b.author:
            author_counts[b.author.strip()] += 1
        review = reviews.get(b.key)
        if review:
            ratings.append(review.rating)
        book_rows.append(
            PeriodBookOut(
                key=b.key,
                work_key=work.key if work else b.match_key,
                title=b.title,
                author=b.author,
                cover_url=b.cover_thumb_url or b.cover_url,
                finished_on=b.finished_on,
                rating=review.rating if review else None,
                topics=book_topics,
                notes_count=len(b.notes),
                has_comment=bool(b.note),
            )
        )

    # Months of a year, days of a month, years of all time.
    units: dict[str, list[int]] = {}
    if year is None:
        for y in years:
            units[str(y)] = [0, 0]
        cut = 4
    elif month is None:
        for mth in range(1, 13):
            units[f"{year}-{mth:02d}"] = [0, 0]
        cut = 7
    else:
        first = date(year, month, 1)
        day = first
        while day.month == month:
            units[day.isoformat()] = [0, 0]
            day += timedelta(days=1)
        cut = 10
    for d, m in in_days.items():
        units.setdefault(d.isoformat()[:cut], [0, 0])[0] += m
    for b in in_books:
        if b.finished_on:
            units.setdefault(b.finished_on[:cut], [0, 0])[1] += 1

    best = max(in_days.items(), key=lambda kv: kv[1]) if in_days else None
    total_topics = sum(topic_counts.values())
    return ReadingOverviewOut(
        period=period,
        years=years,
        months=months,
        minutes=sum(in_days.values()),
        days_read=len(in_days),
        longest_streak=_streak(list(in_days)),
        best_day=BestDayOut(date=best[0].isoformat(), minutes=best[1]) if best else None,
        units=[UnitOut(key=k, minutes=v[0], books=v[1]) for k, v in sorted(units.items())],
        books=sorted(book_rows, key=lambda r: r.finished_on or "", reverse=True),
        topics=[
            TopicShareOut(key=k, count=c, share=round(100 * c / total_topics) if total_topics else 0)
            for k, c in topic_counts.most_common()
        ],
        authors=[AuthorCountOut(name=a, count=c) for a, c in author_counts.most_common(6) if c >= 2],
        avg_rating=round(sum(ratings) / len(ratings), 1) if ratings else None,
        rated_count=len(ratings),
        notes_count=notes_count,
        ai_available=claude.available(),
    )


# ---------- readers like you ----------


def recommendations(db: Session, *, user: User, limit: int = 12) -> list[RecommendationOut]:
    """Books read by the readers whose shelves overlap yours the most,
    weighted by how you rated the books you share and how they rated theirs.
    Nothing to go on yet: the books the whole community rates highest."""
    idx = catalog.index(db)
    ids = ClaimsRepository(db).effective_user_ids(user_id=user.id)
    me = {idx.person_of(i) for i in ids}
    mine: set[str] = set().union(*(idx.by_person.get(p, set()) for p in me)) if me else set()

    marks = books_service._marks(db, idx)
    facts = books_service.facts_by_work(db, idx)
    sale = books_service._for_sale(db, idx)

    # Everyone's marks, by person and book, to weigh with.
    rated: dict[uuid.UUID, dict[str, int]] = defaultdict(dict)
    from app.models.book_review import BookReview

    for account, key, rating in db.execute(select(BookReview.user_id, BookReview.work_key, BookReview.rating)).all():
        work = idx.find(key)
        if work is not None:
            rated[idx.person_of(account)][work.key] = rating
    my_marks: dict[str, int] = {}
    for p in me:
        my_marks.update(rated.get(p, {}))

    def my_weight(key: str) -> float:
        r = my_marks.get(key)
        return 1.0 if r is None else max(0.0, 1 + (r - 6) / 4)

    def quality(key: str) -> float:
        q = 0.0
        if key in marks:
            q += marks[key].weighted / 10
        fact = facts.get(key)
        if fact is not None and fact.rating is not None:
            q += float(fact.rating) / float(fact.rating_scale or 5)
        return q

    scores: dict[str, float] = defaultdict(float)
    if mine:
        neighbours: list[tuple[float, uuid.UUID]] = []
        for person, theirs in idx.by_person.items():
            if person in me or not theirs:
                continue
            shared = mine & theirs
            if not shared:
                continue
            sim = sum(my_weight(k) for k in shared) / math.sqrt(len(theirs) * len(mine))
            neighbours.append((sim, person))
        neighbours.sort(reverse=True)
        for sim, person in neighbours[:60]:
            their_marks = rated.get(person, {})
            for key in idx.by_person[person] - mine:
                r = their_marks.get(key)
                factor = 1.0 if r is None else max(0.0, 1 + (r - 6) / 4)
                scores[key] += sim * factor
        for key in list(scores):
            scores[key] *= 1 + 0.35 * quality(key)

    reason = "co_read"
    if not scores:
        reason = "popular"
        for key, work in idx.works.items():
            if key in mine or len(work.readers) < 2:
                continue
            scores[key] = quality(key) + math.log1p(len(work.readers)) / 3

    picked = sorted(scores.items(), key=lambda kv: -kv[1])[:limit]
    out: list[RecommendationOut] = []
    for key, _ in picked:
        work = idx.works[key]
        item = books_service._item(work, marks.get(key), facts.get(key), sale.get(key, 0), None)
        because_key = because_title = None
        shared_readers = 0
        if reason == "co_read":
            for my_key in mine:
                mine_work = idx.works.get(my_key)
                if mine_work is None:
                    continue
                n = len(work.readers & mine_work.readers)
                if n > shared_readers or (n == shared_readers and n and my_weight(my_key) > my_weight(because_key or "")):
                    shared_readers, because_key, because_title = n, my_key, mine_work.title
        out.append(
            RecommendationOut(
                book=CatalogItemOut.model_validate(item.model_dump()),
                reason=reason,
                because_title=because_title,
                because_key=because_key,
                shared_readers=shared_readers,
            )
        )
    return out


# ---------- the notebook ----------


def notebook(db: Session, *, user: User) -> list[NotebookEntryOut]:
    """Every book the reader wrote something about: the words they finished
    it with, the notes on the shelf, their review."""
    shelf = _shelf(db, user)
    idx = catalog.index(db)
    reviews = {r.volume_key: r for r in books_service.reviews_for_shelf(db, user.id) if r.volume_key}
    out: list[NotebookEntryOut] = []
    for b in shelf.books:
        review = reviews.get(b.key)
        if not (b.note or b.notes or (review and review.text)):
            continue
        work = _work_of(idx, b)
        stamps = [n.created_at.date().isoformat() for n in b.notes] + [b.finished_on or ""]
        out.append(
            NotebookEntryOut(
                key=b.key,
                work_key=work.key if work else b.match_key,
                title=b.title,
                author=b.author,
                cover_url=b.cover_thumb_url or b.cover_url,
                finished_on=b.finished_on,
                comment=b.note,
                comment_private=b.note_is_private,
                notes=[NoteOut(id=n.id, text=n.text, created_at=n.created_at) for n in b.notes],
                rating=review.rating if review else None,
                review=review.text if review else None,
                last_at=max(stamps) or None,
            )
        )
    out.sort(key=lambda e: e.last_at or "", reverse=True)
    return out


# ---------- Claude's letters ----------

_PERIOD_SYSTEM = (
    "You are the reading companion of PowerBook, a reading community in Kazakhstan. A member asked you to "
    "look back on their reading over a period. You get what they finished (with their own marks, reviews, "
    "the words they finished each book with, and their notes), how many minutes they read and on which "
    "days, and the topics of the books. Write to them directly, warmly and specifically: name their actual "
    "books, notice what connects them, what their notes keep returning to, and how their reading habits "
    "looked in the numbers. No flattery, no generic advice, no invented facts about the books — if you are "
    "not sure about a book, say only what their own words say. Suggest three to five books they have not "
    "read yet that follow from what they loved. Write everything in {lang}."
)

_PERIOD_SCHEMA = {
    "type": "object",
    "properties": {
        "headline": {"type": "string"},
        "summary": {"type": "string"},
        "themes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"title": {"type": "string"}, "text": {"type": "string"}},
                "required": ["title", "text"],
                "additionalProperties": False,
            },
        },
        "patterns": {"type": "array", "items": {"type": "string"}},
        "from_notes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"book": {"type": "string"}, "idea": {"type": "string"}},
                "required": ["book", "idea"],
                "additionalProperties": False,
            },
        },
        "next_reads": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"title": {"type": "string"}, "author": {"type": "string"}, "why": {"type": "string"}},
                "required": ["title", "author", "why"],
                "additionalProperties": False,
            },
        },
        "question": {"type": "string"},
    },
    "required": ["headline", "summary", "themes", "patterns", "from_notes", "next_reads", "question"],
    "additionalProperties": False,
}

_BOOK_SYSTEM = (
    "You are the reading companion of PowerBook, a reading community in Kazakhstan. A member asked you to "
    "draw their notes on one book together. You get the book, the words they finished it with, their notes "
    "(in the order written), their mark and review. Gather the main ideas they took from it, the moments "
    "that stayed with them (paraphrase their notes, keep their voice), and how it connects to other books "
    "they read, if it plainly does. Stay with what they wrote; add what the book itself is about only where "
    "you are sure. End with one question worth thinking about. Write everything in {lang}."
)

_BOOK_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "key_ideas": {"type": "array", "items": {"type": "string"}},
        "moments": {"type": "array", "items": {"type": "string"}},
        "connections": {"type": "array", "items": {"type": "string"}},
        "question": {"type": "string"},
    },
    "required": ["summary", "key_ideas", "moments", "connections", "question"],
    "additionalProperties": False,
}


def _cut(text: str | None, limit: int) -> str | None:
    if not text:
        return None
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _period_input(db: Session, user: User, scope: str) -> dict:
    data = overview(db, user=user, period=scope)
    shelf = {b.key: b for b in _shelf(db, user).books}
    reviews = {r.volume_key: r for r in books_service.reviews_for_shelf(db, user.id) if r.volume_key}
    books = []
    budget = 60_000
    for row in data.books:
        vol = shelf.get(row.key)
        review = reviews.get(row.key)
        entry = {
            "title": row.title,
            "author": row.author,
            "finished_on": row.finished_on,
            "my_mark_out_of_10": row.rating,
            "my_review": _cut(review.text if review else None, 1500),
            "finished_with": _cut(vol.note if vol else None, 1200),
            "notes": [_cut(n.text, 1200) for n in (vol.notes if vol else [])][:12],
            "topics": row.topics,
        }
        size = len(json.dumps(entry, ensure_ascii=False))
        if size > budget:
            entry["notes"] = entry["notes"][:2]
        budget -= size
        books.append(entry)
    return {
        "period": scope,
        "minutes_read": data.minutes,
        "days_read": data.days_read,
        "longest_streak_days": data.longest_streak,
        "best_day": data.best_day.model_dump() if data.best_day else None,
        "per_unit": [u.model_dump() for u in data.units if u.minutes or u.books],
        "topics": [t.model_dump() for t in data.topics],
        "books_finished": books,
    }


def _book_input(db: Session, user: User, scope: str) -> dict:
    shelf = _shelf(db, user)
    vol = next((b for b in shelf.books if b.key == scope), None)
    if vol is None:
        raise _bad("book_not_on_shelf", status.HTTP_404_NOT_FOUND)
    review = next((r for r in books_service.reviews_for_shelf(db, user.id) if r.volume_key == vol.key), None)
    others = [b.title for b in shelf.books if b.key != vol.key and b.status == "finished"][:60]
    return {
        "book": {"title": vol.title, "author": vol.author, "finished_on": vol.finished_on},
        "finished_with": _cut(vol.note, 2000),
        "notes": [{"written": n.created_at.date().isoformat(), "text": _cut(n.text, 2000)} for n in vol.notes][:60],
        "my_mark_out_of_10": review.rating if review else None,
        "my_review": _cut(review.text if review else None, 3000),
        "other_books_i_read": others,
    }


def _hash(kind: str, lang: str, payload: dict) -> str:
    raw = json.dumps({"kind": kind, "lang": lang, "model": settings.ai_model, "input": payload}, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _digest_out(row: AiDigest, *, stale: bool = False) -> DigestOut:
    return DigestOut(
        id=row.id,
        kind=row.kind,
        scope=row.scope,
        lang=row.lang,
        status=row.status,
        content=row.content,
        error=row.error,
        updated_at=row.updated_at,
        stale=stale,
    )


def _check(kind: str, scope: str, lang: str) -> None:
    if kind not in ("period", "book"):
        raise _bad("bad_kind")
    if lang not in _LANG_NAMES:
        raise _bad("bad_lang")
    if kind == "period":
        _parse_period(scope)


def _input(db: Session, user: User, kind: str, scope: str) -> dict:
    if kind == "period":
        payload = _period_input(db, user, scope)
        if not payload["books_finished"] and not payload["minutes_read"]:
            raise _bad("nothing_to_summarise")
        return payload
    payload = _book_input(db, user, scope)
    if not payload["notes"] and not payload["finished_with"] and not payload["my_review"]:
        raise _bad("nothing_to_summarise")
    return payload


def _current(db: Session, user: User, kind: str, scope: str, lang: str) -> AiDigest | None:
    return db.execute(
        select(AiDigest)
        .where(AiDigest.user_id == user.id, AiDigest.kind == kind, AiDigest.scope == scope, AiDigest.lang == lang)
        .order_by(AiDigest.updated_at.desc())
    ).scalars().first()


def get_digest(db: Session, *, user: User, kind: str, scope: str, lang: str) -> DigestOut | None:
    _check(kind, scope, lang)
    row = _current(db, user, kind, scope, lang)
    if row is None:
        return None
    stale = False
    if row.status == "done":
        try:
            stale = row.input_hash != _hash(kind, lang, _input(db, user, kind, scope))
        except HTTPException:
            stale = False
    return _digest_out(row, stale=stale)


def start_digest(db: Session, *, user: User, kind: str, scope: str, lang: str, force: bool = False) -> DigestOut:
    _check(kind, scope, lang)
    if not claude.available():
        raise _bad("ai_off", status.HTTP_503_SERVICE_UNAVAILABLE)
    payload = _input(db, user, kind, scope)
    digest_hash = _hash(kind, lang, payload)
    row = _current(db, user, kind, scope, lang)
    now = datetime.now(timezone.utc)
    if row is not None:
        updated = row.updated_at if row.updated_at.tzinfo else row.updated_at.replace(tzinfo=timezone.utc)
        if row.status == "working" and updated > now - timedelta(minutes=6):
            return _digest_out(row)
        if row.status == "done" and row.input_hash == digest_hash and not force:
            return _digest_out(row)

    recent = db.execute(
        select(func.count()).where(AiDigest.user_id == user.id, AiDigest.updated_at > now - timedelta(days=1))
    ).scalar_one()
    if recent >= _DAILY_LIMIT:
        raise _bad("ai_daily_limit", status.HTTP_429_TOO_MANY_REQUESTS)

    if row is None:
        row = AiDigest(user_id=user.id, kind=kind, scope=scope, lang=lang, input_hash=digest_hash, status="working")
        db.add(row)
    else:
        row.status, row.input_hash, row.error = "working", digest_hash, None
        row.updated_at = now
    db.commit()
    db.refresh(row)
    threading.Thread(target=_write, args=(row.id, kind, lang, payload), daemon=True).start()
    return _digest_out(row)


def _write(digest_id: uuid.UUID, kind: str, lang: str, payload: dict) -> None:
    from app.db.session import get_session_factory

    db = get_session_factory()()
    try:
        row = db.get(AiDigest, digest_id)
        if row is None:
            return
        system = (_PERIOD_SYSTEM if kind == "period" else _BOOK_SYSTEM).format(lang=_LANG_NAMES[lang])
        schema = _PERIOD_SCHEMA if kind == "period" else _BOOK_SCHEMA
        try:
            content = claude.ask_json(system=system, prompt=json.dumps(payload, ensure_ascii=False, default=str), schema=schema)
            row.content, row.status, row.error = content, "done", None
        except claude.AiUnavailable:
            row.status, row.error = "error", "ai_unavailable"
        except claude.AiRefused:
            row.status, row.error = "error", "ai_refused"
        except Exception as exc:
            logger.exception("digest %s failed", digest_id)
            row.status, row.error = "error", str(exc)[:300] or "failed"
        db.commit()
    finally:
        db.close()
