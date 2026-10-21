"""Is this a real book? A title and author the AI librarian named from outside the club's library, looked up in the
catalogues the covers already use (app/services/covers.py: Google Books, Open Library, Flip.kz).

A book counts only when a catalogue has an edition with the same title by the same author: nothing the AI made up
gets through. Its cover is fetched and kept like any other when a catalogue has one (Flip.kz is asked too); a book
with none is painted, as the library paints its own.
"""
from __future__ import annotations

import logging
import threading
from dataclasses import dataclass

from app.services import covers

logger = logging.getLogger(__name__)

# What was looked up in this process, found or not: a title asked about twice is looked up once.
_seen: dict[tuple[str, str], Found | None] = {}
_lock = threading.Lock()


@dataclass
class Found:
    title: str
    author: str | None
    # the stored cover (book_face.cover_urls), when a catalogue had one
    image: str | None
    # the edition's page in the catalogue it came from
    link: str | None
    source: str


def _link(candidate) -> str | None:
    if candidate.source == "google":
        return f"https://books.google.com/books?id={candidate.volume_id}"
    if candidate.source == "flip":
        return f"https://www.flip.kz/catalog?prod={candidate.volume_id}"
    return None


def _author_agrees(author: str | None, candidate) -> bool:
    if not author:
        return True
    if not candidate.creators:
        return False
    return covers._author_in(covers.match_key(author), " ".join(candidate.creators))


def find(title: str, author: str | None) -> Found | None:
    """The book, when a catalogue has an edition of it by this author with a cover; else None."""
    title, author = (title or "").strip(), (author or "").strip() or None
    if not title:
        return None
    cache = (covers.match_key(title), covers.match_key(author or ""))
    with _lock:
        if cache in _seen:
            return _seen[cache]
    found = _look_up(title, author)
    with _lock:
        _seen[cache] = found
    return found


def _matches(title: str, author: str | None, candidates) -> list:
    found = [m for c in candidates if (m := covers._judge(title, author, c)) and _author_agrees(author, c)]
    return sorted(found, key=lambda m: -m.score)


def _cover(match) -> str | None:
    candidate = match.candidate
    try:
        images = covers._fetch_images(candidate) or covers._fetch_images(candidate, min_width=110)
    except Exception:
        images = None
    return covers._store(covers.cover_key(match.title or candidate.titles[0]), candidate.volume_id, images) if images else None


def _look_up(title: str, author: str | None) -> Found | None:
    query = f"{title} {author}" if author else title
    matches = []
    # Google answers a 500 now and then: an empty answer is asked once more
    for _ in range(2):
        try:
            candidates = covers.search_any(query)
        except Exception:
            logger.warning("book lookup failed for %r", query, exc_info=True)
            candidates = []
        if candidates:
            matches = _matches(title, author, candidates)
            break
    # a Kazakh or local edition no world catalogue holds, or a cover none of them has: Flip.kz
    flip: list = []
    if covers._script(title) == "cyr" and not any(m.candidate.has_thumbnail for m in matches):
        try:
            flip = _matches(title, author, covers._search_flip(title))
        except Exception:
            logger.warning("flip lookup failed for %r", title, exc_info=True)
    if not matches and not flip:
        return None
    best = (matches or flip)[0]
    image = None
    for match in (flip + matches)[:3]:
        image = _cover(match)
        if image:
            break
    return Found(
        title=best.title or title,
        author=best.author or author,
        image=image,
        link=_link(best.candidate),
        source=best.candidate.source,
    )
