"""A book's DNA: what it is like to read, beyond its genre — mood, pace, length, themes, form, style, era, and how
demanding it is. The AI librarian (app/services/librarian.py) matches books to a reader's taste by it.

The founder (2026-10-22): picks from a deep reading of the reader's taste, not from one shared ten. The AI writes
each book's DNA once, a batch at a time, from what it knows and the book's description; only words of VOCAB are kept,
so the traits can be counted and compared. A book the AI does not know well enough is "unknown" and is matched by
the other signals alone.

    python -m app.services.book_dna backfill [limit]
    python -m app.services.book_dna retry-unknown [limit]   # the books it did not know, asked again
"""
from __future__ import annotations

import fcntl
import json
import logging
import sys
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.book_dna import BookDna
from app.services import books as books_service
from app.services import catalog, llm

logger = logging.getLogger(__name__)

# Every trait a book can have. Single-valued groups hold one word; the others a short list.
VOCAB: dict[str, tuple[str, ...]] = {
    "mood": ("warm", "dark", "light", "melancholic", "hopeful", "tense", "funny", "philosophical", "romantic", "inspiring"),
    "pace": ("slow", "medium", "fast"),
    "length": ("short", "medium", "long"),
    "themes": (
        "friendship", "love", "family", "war", "faith", "coming_of_age", "identity", "society", "history", "power",
        "loss", "freedom", "survival", "work_success", "psychology", "science", "nature", "homeland", "revenge",
        "adventure", "mystery", "fantasy", "self_growth", "spirituality", "money", "health",
    ),
    "form": ("novel", "stories", "nonfiction", "memoir", "poetry", "play"),
    "style": ("simple", "literary", "poetic", "humorous", "documentary"),
    "era": ("classic", "modern", "contemporary"),
    "ease": ("easy", "medium", "demanding"),
}
SINGLE = ("pace", "length", "form", "era", "ease")
LIMITS = {"mood": 3, "themes": 5, "style": 2}
# How much each group says about a reader's taste (themes and mood most; era and form least).
GROUP_WEIGHT = {"mood": 1.0, "themes": 1.0, "pace": 0.7, "style": 0.6, "ease": 0.6, "length": 0.5, "form": 0.5, "era": 0.4}

BATCH = 15
_LOCK_PATH = Path(settings.library_storage_dir).parent / ".book-dna.lock"

_SYSTEM = (
    "You describe books for a reading club's librarian. For each book you get its id, title, author, year and maybe a "
    "description. Say what it is like to read, using ONLY these words:\n{vocab}\n"
    "mood: up to 3, the strongest first; themes: up to 5, the most central first; style: up to 2; the others exactly "
    "one word. `essence`: one plain English sentence (at most 18 words) on what the book is. Kazakh and local books "
    "you may not know: then go by the description and `readers_say` (what the club's readers wrote about it); when "
    "they say enough of what it is like, describe it from them. Set `known` to false only when you do not know the "
    "book and neither the description nor the readers say enough — never guess a book you do not know. "
    "Titles may be Russian or Kazakh translations of world books; recognise them."
)

_SCHEMA = {
    "type": "object",
    "properties": {
        "books": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "known": {"type": "boolean"},
                    "mood": {"type": "array", "items": {"type": "string"}},
                    "pace": {"type": "string"},
                    "length": {"type": "string"},
                    "themes": {"type": "array", "items": {"type": "string"}},
                    "form": {"type": "string"},
                    "style": {"type": "array", "items": {"type": "string"}},
                    "era": {"type": "string"},
                    "ease": {"type": "string"},
                    "essence": {"type": "string"},
                },
                "required": ["id", "known", "mood", "pace", "length", "themes", "form", "style", "era", "ease", "essence"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["books"],
    "additionalProperties": False,
}


def clean(answer: dict) -> dict | None:
    """Only the words of VOCAB, in their places; None when nothing is left."""
    out: dict = {}
    for group, words in VOCAB.items():
        value = answer.get(group)
        if group in SINGLE:
            word = str(value or "").strip().lower()
            if word in words:
                out[group] = word
        else:
            seen = []
            for word in value or []:
                word = str(word).strip().lower()
                if word in words and word not in seen:
                    seen.append(word)
            if seen:
                out[group] = seen[: LIMITS[group]]
    return out if (out.get("themes") or out.get("mood")) else None


def vector(traits: dict | None) -> dict[str, float]:
    """A book's traits as weights: "themes:friendship" → 1.0, the earlier in a list the heavier."""
    if not traits:
        return {}
    vec: dict[str, float] = {}
    for group, value in traits.items():
        if group not in VOCAB:
            continue
        base = GROUP_WEIGHT.get(group, 0.5)
        words = [value] if isinstance(value, str) else list(value)
        for i, word in enumerate(words):
            vec[f"{group}:{word}"] = base * (1.0 - 0.15 * i)
    return vec


def of_works(db: Session) -> dict[str, BookDna]:
    """Each library book's DNA row, by its work key now (a key that moved still finds its row)."""
    idx = catalog.index(db)
    out: dict[str, BookDna] = {}
    for row in db.execute(select(BookDna)).scalars():
        work = idx.find(row.key) or idx.works.get(row.key)
        if work is not None and (work.key not in out or row.status == "done"):
            out[work.key] = row
    return out


def _input(work: catalog.Work, fact, said: list[str]) -> dict:
    about = books_service._localized(fact.about if fact else None, "en")
    text = about[1].get("text") if about else None
    return {
        "title": work.title,
        "author": work.author,
        "year": fact.year if fact else None,
        "description": " ".join(text.split())[:500] if text else None,
        # what the club's readers wrote about it: for a Kazakh or local book no catalogue describes, often all there is
        "readers_say": said or None,
    }


def _readers_say(db: Session, idx: catalog.CatalogIndex, keys: set[str]) -> dict[str, list[str]]:
    """Up to three of the club's own reviews of each book, longest first, cut short."""
    from app.models.book_review import BookReview

    out: dict[str, list[str]] = {}
    for key, text in db.execute(select(BookReview.work_key, BookReview.text).where(BookReview.text.is_not(None))).all():
        work = idx.find(key)
        if work is None or work.key not in keys or not (text or "").strip():
            continue
        out.setdefault(work.key, []).append(" ".join(text.split())[:300])
    return {k: sorted(v, key=len, reverse=True)[:3] for k, v in out.items()}


def tag(db: Session, limit: int = BATCH) -> int:
    """Write the DNA of up to `limit` books that have none yet, most-read first. Returns how many were written."""
    if not llm.available():
        return 0
    idx = catalog.index(db)
    # a book whose DNA is written; one the AI did not know is asked again while it has tries left
    have = {k for k, row in of_works(db).items() if row.status == "done"}
    tried = {row.key: row for row in db.execute(select(BookDna)).scalars()}
    # books never tried first, the most read first; a book tried before only after them
    todo = [
        w for w in sorted(idx.works.values(), key=lambda w: (tried[w.key].attempts if w.key in tried else 0, -len(w.readers)))
        if w.key not in have and (tried.get(w.key) is None or tried[w.key].attempts < 3)
    ][:limit]
    if not todo:
        return 0
    facts = books_service.facts_by_work(db, idx)
    said = _readers_say(db, idx, {w.key for w in todo})
    ids = {f"b{i + 1}": w for i, w in enumerate(todo)}
    vocab = "\n".join(f"{g}: {', '.join(words)}" for g, words in VOCAB.items())
    try:
        answer = llm.ask_json(
            system=_SYSTEM.format(vocab=vocab),
            prompt=json.dumps(
                {"books": [{"id": i, **_input(w, facts.get(w.key), said.get(w.key, []))} for i, w in ids.items()]},
                ensure_ascii=False,
            ),
            schema=_SCHEMA,
            effort="low",
            max_tokens=6000,
        )
    except Exception:
        logger.exception("book dna batch failed")
        answer = {"books": []}
    by_id = {str(b.get("id", "")).strip(): b for b in answer.get("books", [])}
    written = 0
    for cid, work in ids.items():
        row = tried.get(work.key) or BookDna(key=work.key, title=work.title[:300], attempts=0)
        if row not in db:
            db.add(row)
        row.title, row.author = work.title[:300], (work.author or None) and work.author[:200]
        row.attempts += 1
        row.model = llm.model_name()[:60]
        got = by_id.get(cid)
        traits = clean(got) if got else None
        if got is None:
            row.status = "error"
        elif not got.get("known") or traits is None:
            row.status, row.traits = "unknown", traits
        else:
            row.status, row.traits = "done", traits
            row.essence = str(got.get("essence") or "").strip()[:300] or None
            written += 1
    db.commit()
    return written


def scheduled() -> None:
    """The scheduler's tick: a couple of batches, one process at a time across the workers."""
    from app.db.session import get_session_factory

    if not llm.available():
        return
    _LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(_LOCK_PATH, "w") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            return
        db = get_session_factory()()
        try:
            for _ in range(2):
                if not tag(db):
                    break
        except Exception:
            logger.exception("book dna tick failed")
            db.rollback()
        finally:
            db.close()
            fcntl.flock(handle, fcntl.LOCK_UN)


def _backfill(limit: int, retry_unknown: bool = False) -> None:
    from app.db.session import get_session_factory

    db = get_session_factory()()
    total = 0
    try:
        if retry_unknown:
            # asked again, now with what the club's readers wrote about them
            for row in db.execute(select(BookDna).where(BookDna.status.in_(("unknown", "error")))).scalars():
                row.attempts = 0
            db.commit()
        while total < limit:
            n = tag(db, min(BATCH, limit - total))
            if not n and not _pending(db):
                break
            total += max(n, 1)
            print(f"… {total}", flush=True)
    finally:
        db.close()
    print(f"done: {total}")


def _pending(db: Session) -> bool:
    idx = catalog.index(db)
    have = {k for k, row in of_works(db).items() if row.status == "done"}
    tried = {row.key: row.attempts for row in db.execute(select(BookDna)).scalars()}
    return any(w.key not in have and tried.get(w.key, 0) < 3 for w in idx.works.values())


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] in ("backfill", "retry-unknown"):
        _backfill(int(sys.argv[2]) if len(sys.argv) > 2 else 5000, retry_unknown=sys.argv[1] == "retry-unknown")
    else:
        print(__doc__)
