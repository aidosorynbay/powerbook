"""What the world says about each book of the shared library.

For every book, in the background, a little at a time:

  * its rating elsewhere — Google Books and Open Library both count out of
    five; whichever has more votes is shown, with the count and a link;
  * what it is about — the opening of its Wikipedia article (in Russian,
    Kazakh and English where they exist), or the publisher's note from
    Google Books when Wikipedia has nothing;
  * a link to its Goodreads page, which Open Library records;
  * its subjects, folded into our topic keys for the reading summaries.

When a Claude key is set and AI_BOOK_FACTS is on, a second pass asks Claude
to search the web for the book's Goodreads rating (LiveLib for books
Goodreads doesn't know) and to say in a few sentences, in its own words,
what readers think of it. Goodreads is the largest readers' catalogue in
the world, so its number replaces the thinner Google/Open Library one.

    python -m app.services.book_facts backfill [--limit N]   # the free sources
    python -m app.services.book_facts ai [--limit N]         # the Claude pass
"""
from __future__ import annotations

import fcntl
import html
import json
import logging
import re
import sys
import time
import urllib.error
import urllib.parse
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.book_fact import BookFact
from app.services import catalog, covers, topics
from app.services.catalog import Work

logger = logging.getLogger(__name__)

_API = "https://www.googleapis.com/books/v1/volumes"
_OPEN_LIBRARY = "https://openlibrary.org/search.json"
_WIKIDATA = "https://www.wikidata.org/w/api.php"
_LOCK_PATH = Path(settings.library_storage_dir).parent / ".book-facts.lock"
_google_resting_until = [0.0]
# A rating from a handful of votes says more about those few than the book.
_MIN_VOTES = 10

# Literary work, novel, book, written work, novella, short story, poem,
# literary series, novel series, essay, non-fiction work.
_WORK_CLASSES = {
    "Q7725634", "Q8261", "Q571", "Q47461344", "Q149537", "Q49084", "Q5185279", "Q1667921", "Q277759",
    "Q35760", "Q213051",
}


def _json(url: str) -> dict:
    return json.loads(covers._paced(url))


def _strip_html(text: str) -> str:
    text = re.sub(r"<br\s*/?>|</p>", "\n", text or "", flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    return re.sub(r"[ \t]+", " ", re.sub(r"\n{3,}", "\n\n", text)).strip()


def _shorten(text: str, limit: int = 700) -> str:
    if len(text) <= limit:
        return text
    cut = text[:limit]
    end = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    return (cut[: end + 1] if end > limit * 0.5 else cut.rstrip() + "…").strip()


# ---------- Google Books ----------


def _google_volume(volume_id: str) -> dict | None:
    params = {"key": settings.google_books_api_key} if settings.google_books_api_key else {}
    url = f"{_API}/{urllib.parse.quote(volume_id)}" + (f"?{urllib.parse.urlencode(params)}" if params else "")
    try:
        return _json(url).get("volumeInfo")
    except urllib.error.HTTPError as exc:
        if exc.code in (403, 429):
            raise
        return None


def _google_match(work: Work) -> str | None:
    """A Google edition of the book, by the same judge the covers use."""
    query = f"{work.title} {work.author}" if work.author else work.title
    try:
        candidates = covers._search(query)
    except urllib.error.HTTPError:
        raise
    except Exception:
        return None
    judged = [m for m in (covers._judge(work.title, work.author, c) for c in candidates) if m]
    judged.sort(key=lambda m: m.score, reverse=True)
    return judged[0].candidate.volume_id if judged else None


# ---------- Open Library ----------


def _open_library(work: Work) -> dict | None:
    params = {
        "title": work.title,
        "limit": 5,
        "fields": "key,title,subtitle,author_name,ratings_average,ratings_count,first_publish_year,subject,"
        "id_goodreads,number_of_pages_median",
    }
    if work.author:
        params["author"] = work.author
    try:
        docs = _json(f"{_OPEN_LIBRARY}?{urllib.parse.urlencode(params)}").get("docs", [])
    except Exception:
        return None
    for doc in docs:
        if not doc.get("title"):
            continue
        candidate = covers._Candidate(
            volume_id=doc.get("key", ""),
            titles=[doc["title"]] + ([doc["subtitle"]] if doc.get("subtitle") else []),
            creators=list(doc.get("author_name") or []),
            has_thumbnail=False,
            source="openlibrary",
        )
        if covers._judge(work.title, work.author, candidate):
            return doc
    return None


# ---------- Wikipedia ----------


def _wikipedia(work: Work) -> tuple[dict, list[str], int | None]:
    """({lang: {text, source, url}}, genre names, year) from the book's
    Wikidata item — only an item that is a literary work and carries the
    reader's title as its name counts."""
    lang = "ru" if covers._script(work.title) == "cyr" else "en"
    found = _json(
        f"{_WIKIDATA}?"
        + urllib.parse.urlencode(
            {"action": "wbsearchentities", "search": work.title, "language": lang, "uselang": lang,
             "type": "item", "limit": 7, "format": "json"}
        )
    ).get("search", [])
    ours = covers.match_key(work.title)
    ids = [
        x["id"]
        for x in found
        if covers.match_key(x.get("label", "")) == ours or covers.match_key(x.get("match", {}).get("text", "")) == ours
    ]
    if not ids:
        return {}, [], None
    entities = _json(
        f"{_WIKIDATA}?"
        + urllib.parse.urlencode({"action": "wbgetentities", "ids": "|".join(ids[:5]), "props": "claims|sitelinks", "format": "json"})
    ).get("entities", {})
    for qid in ids[:5]:
        entity = entities.get(qid, {})
        claims = entity.get("claims", {})
        kinds = {c["mainsnak"].get("datavalue", {}).get("value", {}).get("id") for c in claims.get("P31", [])}
        if not kinds & _WORK_CLASSES:
            continue
        if work.author:
            # An author we know must not contradict the item's.
            names = []
            author_ids = [c["mainsnak"].get("datavalue", {}).get("value", {}).get("id") for c in claims.get("P50", [])]
            author_ids = [a for a in author_ids if a]
            if author_ids:
                people = _json(
                    f"{_WIKIDATA}?"
                    + urllib.parse.urlencode({"action": "wbgetentities", "ids": "|".join(author_ids[:3]), "props": "labels|aliases", "format": "json"})
                ).get("entities", {})
                for person in people.values():
                    names += [v.get("value", "") for v in person.get("labels", {}).values()]
                    names += [a.get("value", "") for al in person.get("aliases", {}).values() for a in al]
                if names and not any(covers._author_in(covers.match_key(work.author), n) for n in names):
                    continue
        year = None
        for claim in claims.get("P577", [])[:1]:
            value = claim["mainsnak"].get("datavalue", {}).get("value", {}).get("time", "")
            m = re.match(r"^[+-](\d{4})", value)
            if m:
                year = int(m.group(1))
        genre_ids = [c["mainsnak"].get("datavalue", {}).get("value", {}).get("id") for c in claims.get("P136", [])]
        genre_ids = [g for g in genre_ids if g][:6]
        # A novel is fiction even when no genre is named.
        genres: list[str] = ["novel"] if "Q8261" in kinds else []
        if genre_ids:
            labels = _json(
                f"{_WIKIDATA}?"
                + urllib.parse.urlencode({"action": "wbgetentities", "ids": "|".join(genre_ids), "props": "labels", "languages": "en|ru", "format": "json"})
            ).get("entities", {})
            for g in labels.values():
                for l in ("en", "ru"):
                    if g.get("labels", {}).get(l):
                        genres.append(g["labels"][l]["value"])
        about: dict = {}
        for wiki_lang in ("ru", "kk", "en"):
            page = entity.get("sitelinks", {}).get(f"{wiki_lang}wiki", {}).get("title")
            if not page:
                continue
            try:
                summary = _json(
                    f"https://{wiki_lang}.wikipedia.org/api/rest_v1/page/summary/{urllib.parse.quote(page.replace(' ', '_'))}"
                )
            except Exception:
                continue
            text = (summary.get("extract") or "").strip()
            if len(text) < 60:
                continue
            about[wiki_lang] = {
                "text": _shorten(text, 900),
                "source": "wikipedia",
                "url": summary.get("content_urls", {}).get("desktop", {}).get("page")
                or f"https://{wiki_lang}.wikipedia.org/wiki/{urllib.parse.quote(page)}",
            }
        return about, genres, year
    return {}, [], None


# ---------- one book ----------


def _cover_row(db: Session, work: Work):
    rows = covers.cached(db, [covers.cover_key(work.title)])
    row = rows.get(covers.cover_key(work.title))
    return row if row is not None and row.status == "found" else None


def look_up(db: Session, fact: BookFact, work: Work) -> None:
    """Fill a facts row from the free sources."""
    # The catalogues' own classification first; Open Library's subjects are
    # tags anyone added and only speak when nothing else does.
    subjects: list[str] = []
    loose: list[str] = []
    ratings: list[tuple[float, int, str, str | None]] = []
    about: dict = dict(fact.about or {})
    year = fact.year
    pages = fact.pages
    description = None

    # Google: the edition the cover lookup already matched, else a fresh search.
    row = _cover_row(db, work)
    volume_id = row.source_id if row is not None and row.source == "google" and row.source_id else None
    info: dict = {}
    if time.time() > _google_resting_until[0]:
        try:
            volume_id = volume_id or _google_match(work)
            info = (_google_volume(volume_id) or {}) if volume_id else {}
        except urllib.error.HTTPError as exc:
            if exc.code not in (403, 429):
                raise
            # Out of quota for today: the other sources carry on without it.
            _google_resting_until[0] = time.time() + 6 * 3600
    if info:
        subjects += list(info.get("categories") or [])
        if info.get("averageRating") and int(info.get("ratingsCount") or 0) >= _MIN_VOTES:
            ratings.append((float(info["averageRating"]), int(info["ratingsCount"]), "google",
                            info.get("canonicalVolumeLink") or f"https://books.google.com/books?id={volume_id}"))
        pages = pages or info.get("pageCount") or None
        published = str(info.get("publishedDate") or "")[:4]
        if published.isdigit() and not year:
            year = int(published)
        if info.get("description"):
            description = (_strip_html(info["description"]), (info.get("language") or "").lower())

    doc = _open_library(work)
    if doc:
        loose += list(doc.get("subject") or [])[:20]
        if doc.get("ratings_average") and int(doc.get("ratings_count") or 0) >= _MIN_VOTES:
            ratings.append((float(doc["ratings_average"]), int(doc["ratings_count"]), "openlibrary",
                            f"https://openlibrary.org{doc['key']}" if doc.get("key") else None))
        goodreads = [g for g in doc.get("id_goodreads") or [] if str(g).isdigit()]
        if goodreads and not fact.goodreads_url:
            fact.goodreads_url = f"https://www.goodreads.com/book/show/{goodreads[0]}"
        if doc.get("first_publish_year"):
            year = min(year, int(doc["first_publish_year"])) if year else int(doc["first_publish_year"])
        pages = pages or doc.get("number_of_pages_median") or None

    try:
        wiki, genres, wiki_year = _wikipedia(work)
    except Exception:
        wiki, genres, wiki_year = {}, [], None
    subjects += genres
    for lang, entry in wiki.items():
        # A text Claude wrote gives way to the article.
        if lang not in about or (about[lang] or {}).get("source") != "wikipedia":
            about[lang] = entry
    if wiki_year:
        year = min(year, wiki_year) if year else wiki_year
    if description and not about:
        text, lang = description
        lang = lang if lang in ("ru", "kk", "en") else ("ru" if covers._script(text) == "cyr" else "en")
        about[lang] = {"text": _shorten(text), "source": "google", "url": f"https://books.google.com/books?id={volume_id}"}

    # Goodreads and LiveLib (from the Claude pass) outrank the thin catalogues.
    if ratings and fact.rating_source not in ("goodreads", "livelib"):
        best = max(ratings, key=lambda r: r[1])
        fact.rating, fact.ratings_count, fact.rating_source, fact.rating_url = round(best[0], 2), best[1], best[2], best[3]
        fact.rating_scale = 5

    fact.about = about or None
    fact.subjects = list(dict.fromkeys(s for s in subjects + loose if s))[:40] or None
    if not fact.topics or fact.ai_status != "found":
        found_topics = topics.from_subjects(subjects, title="", year=year) or topics.from_subjects(loose, title=work.title, year=year)
        fact.topics = found_topics or None
    fact.year = year
    fact.pages = int(pages) if pages else None
    fact.title = work.title[:300]
    fact.author = (work.author or "")[:200] or None
    fact.status = "found" if (fact.rating is not None or fact.about or fact.subjects or fact.goodreads_url) else "none"


# ---------- the Claude pass ----------

_AI_SYSTEM = (
    "You research books for PowerBook, a reading community in Kazakhstan whose members read in Russian, "
    "Kazakh and English. For the book you are given, use web search to find its page on Goodreads and read "
    "the average rating (out of 5) and the number of ratings exactly as the page shows them. If Goodreads "
    "has no page for it (common for Russian and Kazakh books), find it on LiveLib instead. Only report "
    "numbers you actually saw; if you could not find the book, say so and leave the numbers empty. "
    "Then write, in your own words and never quoting a review, two or three sentences on what the book is "
    "about and two or three on what readers praise and criticise in it — each in Russian, Kazakh and "
    "English. Choose one to three topic keys from the list given."
)


def _nullable(kind: str) -> dict:
    return {"anyOf": [{"type": kind}, {"type": "null"}]}


_AI_SCHEMA = {
    "type": "object",
    "properties": {
        "found": {"type": "boolean"},
        "source": {"type": "string", "enum": ["goodreads", "livelib", "none"]},
        "rating": _nullable("number"),
        "ratings_count": _nullable("integer"),
        "url": _nullable("string"),
        "goodreads_url": _nullable("string"),
        "about_ru": {"type": "string"},
        "about_kk": {"type": "string"},
        "about_en": {"type": "string"},
        "readers_ru": {"type": "string"},
        "readers_kk": {"type": "string"},
        "readers_en": {"type": "string"},
        "topics": {"type": "array", "items": {"type": "string", "enum": list(topics.TOPICS)}},
        "year": _nullable("integer"),
    },
    "required": [
        "found", "source", "rating", "ratings_count", "url", "goodreads_url", "about_ru", "about_kk", "about_en",
        "readers_ru", "readers_kk", "readers_en", "topics", "year",
    ],
    "additionalProperties": False,
}


def look_up_ai(fact: BookFact, work: Work) -> None:
    from app.services import claude

    known = {"title": work.title, "author": work.author, "year": fact.year, "subjects": (fact.subjects or [])[:12]}
    prompt = (
        "Book as PowerBook readers recorded it (it may be a Russian or Kazakh translation of a foreign book):\n"
        f"{json.dumps(known, ensure_ascii=False)}\n\n"
        f"Topic keys to choose from: {', '.join(topics.TOPICS)}"
    )
    data = claude.ask_json(system=_AI_SYSTEM, prompt=prompt, schema=_AI_SCHEMA, web_search=True, effort="medium")
    source = data.get("source")
    rating, count, url = data.get("rating"), data.get("ratings_count"), data.get("url")
    if data.get("found") and source in ("goodreads", "livelib") and rating and 0 < float(rating) <= 5:
        fact.rating = round(float(rating), 2)
        fact.rating_scale = 5
        fact.ratings_count = int(count) if count else None
        fact.rating_source = source
        fact.rating_url = url if isinstance(url, str) and url.startswith("https://") else None
    gr = data.get("goodreads_url")
    if isinstance(gr, str) and gr.startswith("https://www.goodreads.com/"):
        fact.goodreads_url = gr
    about = dict(fact.about or {})
    for lang in ("ru", "kk", "en"):
        text = (data.get(f"about_{lang}") or "").strip()
        if text and lang not in about:
            about[lang] = {"text": text, "source": "claude", "url": None}
    fact.about = about or None
    review = {lang: (data.get(f"readers_{lang}") or "").strip() for lang in ("ru", "kk", "en")}
    review = {k: v for k, v in review.items() if v}
    if review and data.get("found"):
        fact.review = review
        fact.review_source = source if source in ("goodreads", "livelib") else "claude"
    chosen = topics.clean(data.get("topics"))
    if chosen:
        fact.topics = chosen
    if data.get("year") and not fact.year:
        fact.year = int(data["year"])
    fact.ai_status = "found" if data.get("found") else "none"
    if fact.status != "found" and (fact.rating is not None or fact.about):
        fact.status = "found"


# ---------- the queue ----------


def _ensure_rows(db: Session, works: list[Work]) -> None:
    """A pending row for every book that has none under any of its keys."""
    known = {k for (k,) in db.execute(select(BookFact.key)).all()}
    fresh = [w for w in works if not (w.members & known)]
    for w in fresh:
        db.add(BookFact(key=w.key, title=w.title[:300], author=(w.author or "")[:200] or None, status="pending"))
    if fresh:
        db.commit()


def _rows_by_work(db: Session, works: dict[str, Work]) -> dict[str, BookFact]:
    idx_rows: dict[str, BookFact] = {}
    member_of = {m: w.key for w in works.values() for m in w.members}
    for row in db.execute(select(BookFact)).scalars().all():
        primary = member_of.get(row.key)
        if primary and (primary not in idx_rows or row.key == primary):
            idx_rows[primary] = row
    return idx_rows


def _claim(db: Session, row: BookFact, *, field: str = "status", due: tuple[str | None, ...] = ("pending",)) -> bool:
    now = datetime.now(timezone.utc)
    column = getattr(BookFact, field)
    named = [d for d in due if d is not None]
    cond = column.in_(named)
    if None in due:
        cond = or_(column.is_(None), column.in_(named)) if named else column.is_(None)
    result = db.execute(update(BookFact).where(BookFact.key == row.key, cond).values({field: "working", "updated_at": now}))
    db.commit()
    return result.rowcount == 1


def _due(row: BookFact) -> bool:
    now = datetime.now(timezone.utc)
    checked = row.checked_at
    if checked is not None and checked.tzinfo is None:
        checked = checked.replace(tzinfo=timezone.utc)
    if row.status == "pending":
        return True
    if row.status == "working":
        updated = row.updated_at.replace(tzinfo=timezone.utc) if row.updated_at.tzinfo is None else row.updated_at
        return updated < now - timedelta(minutes=30)
    if row.status == "error":
        return row.attempts < 5 and (checked is None or checked < now - timedelta(hours=6))
    if row.status == "none":
        return checked is None or checked < now - timedelta(days=45)
    return False


def fill(db: Session, limit: int = 12) -> tuple[int, int]:
    """Look up to `limit` books, most-read first. Returns (done, found)."""
    idx = catalog.index(db)
    works = sorted(idx.works.values(), key=lambda w: (-len(w.readers), w.title))
    _ensure_rows(db, works)
    rows = _rows_by_work(db, idx.works)
    done = found = 0
    for work in works:
        if done >= limit:
            break
        row = rows.get(work.key)
        if row is None or not _due(row):
            continue
        previous = row.status
        if not _claim(db, row, due=(previous,)):
            continue
        db.refresh(row)
        try:
            look_up(db, row, work)
        except urllib.error.HTTPError as exc:
            row.status = "error"
            row.notes = f"http {exc.code}"
            if exc.code in (403, 429):
                row.attempts += 1
                row.checked_at = datetime.now(timezone.utc)
                db.commit()
                break
        except Exception as exc:  # a malformed answer from a catalogue: try again later
            row.status = "error"
            row.notes = str(exc)[:500]
        row.attempts += 1
        row.checked_at = datetime.now(timezone.utc)
        db.commit()
        done += 1
        found += row.status == "found"
    return done, found


def fill_ai(db: Session, limit: int = 4) -> tuple[int, int]:
    """The Claude pass for up to `limit` books, most-read first."""
    from app.services import claude

    if not claude.available():
        return 0, 0
    idx = catalog.index(db)
    works = sorted(idx.works.values(), key=lambda w: (-len(w.readers), w.title))
    rows = _rows_by_work(db, idx.works)
    done = found = 0
    for work in works:
        if done >= limit:
            break
        row = rows.get(work.key)
        # After the free pass, so what it found goes along as a hint.
        if row is None or row.status in ("pending", "working") or row.ai_status is not None:
            continue
        if not _claim(db, row, field="ai_status", due=(None,)):
            continue
        db.refresh(row)
        try:
            look_up_ai(row, work)
        except claude.AiUnavailable:
            row.ai_status = None
            db.commit()
            break
        except Exception as exc:
            logger.warning("book facts ai pass failed for %s: %s", work.key, exc)
            row.ai_status = "error"
            row.notes = str(exc)[:500]
        row.ai_checked_at = datetime.now(timezone.utc)
        db.commit()
        done += 1
        found += row.ai_status == "found"
    return done, found


def scheduled() -> None:
    """The scheduler's tick: one process at a time across the workers."""
    if not settings.book_facts_enabled:
        return
    from app.db.session import get_session_factory

    _LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(_LOCK_PATH, "w") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            return
        db = get_session_factory()()
        try:
            fill(db, limit=12)
            if settings.ai_book_facts:
                fill_ai(db, limit=4)
        except Exception:
            logger.exception("book facts tick failed")
            db.rollback()
        finally:
            db.close()
            fcntl.flock(handle, fcntl.LOCK_UN)


def _arg(name: str, default: int) -> int:
    if name in sys.argv:
        try:
            return int(sys.argv[sys.argv.index(name) + 1])
        except (IndexError, ValueError):
            pass
    return default


if __name__ == "__main__":
    from app.db.session import get_session_factory

    command = sys.argv[1:2]
    session = get_session_factory()()
    if command == ["backfill"]:
        total = _arg("--limit", 100000)
        while total > 0:
            n, f = fill(session, limit=min(20, total))
            print(f"looked up {n}, found {f}", flush=True)
            if n == 0:
                break
            total -= n
    elif command == ["ai"]:
        total = _arg("--limit", 50)
        while total > 0:
            n, f = fill_ai(session, limit=min(5, total))
            print(f"asked Claude about {n}, found {f}", flush=True)
            if n == 0:
                break
            total -= n
    else:
        print(__doc__)
    session.close()
