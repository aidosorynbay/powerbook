"""The last try for a cover: what the founder did by hand — search the web,
find the book in a shop, take its picture — done by Claude.

Claude searches the web for pages that show the book (a shop's product page,
the publisher's); this server opens those pages itself, where their robots
allow it, and takes the picture they name as theirs (og:image). Then Claude
looks at the picture: only the front cover of this very book goes on the
shelf. A wrong cover is worse than a painted one, so anything Claude is not
sure of is dropped.

Runs only after Google Books, Open Library, Flip.kz and Wikipedia have all
come back empty, and only a few times a day per process: each lookup costs
a web search and two calls.
"""
from __future__ import annotations

import base64
import hashlib
import ipaddress
import logging
import re
import socket
import threading
import urllib.parse
import urllib.robotparser
from datetime import date

from app.core.config import settings

logger = logging.getLogger(__name__)

_MAX_PICTURES = 6

_lock = threading.Lock()
_spent: dict[date, int] = {}
_robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}


def _take_turn() -> bool:
    """One of the day's lookups, if any are left."""
    with _lock:
        today = date.today()
        used = _spent.get(today, 0)
        if used >= settings.ai_covers_daily_limit:
            return False
        _spent.clear()
        _spent[today] = used + 1
        return True


def enabled() -> bool:
    from app.services import claude

    return settings.ai_covers and claude.available()


# ---------- the web, carefully ----------


def _public(url: str) -> bool:
    """An https address on the open internet — never this server's own
    network, whatever a web page talked Claude into."""
    parts = urllib.parse.urlsplit(url)
    if parts.scheme != "https" or not parts.hostname:
        return False
    try:
        addresses = {info[4][0] for info in socket.getaddrinfo(parts.hostname, 443, proto=socket.IPPROTO_TCP)}
    except OSError:
        return False
    return bool(addresses) and all(ipaddress.ip_address(a.split("%")[0]).is_global for a in addresses)


def _allowed(url: str) -> bool:
    from app.services.covers import _UA

    parts = urllib.parse.urlsplit(url)
    host = f"{parts.scheme}://{parts.netloc}"
    if host not in _robots:
        parser = urllib.robotparser.RobotFileParser(f"{host}/robots.txt")
        try:
            from app.services.covers import _get

            body, _ = _get(f"{host}/robots.txt", timeout=10)
            parser.parse(body.decode("utf-8", "replace").splitlines())
        except Exception:
            parser = None  # no robots.txt (or none reachable): nothing forbids it
        _robots[host] = parser
    parser = _robots[host]
    return parser is None or parser.can_fetch(_UA["User-Agent"], url)


_OG_IMAGE = re.compile(
    r'<meta[^>]+(?:property|name)=["\'](?:og:image(?::secure_url)?|twitter:image)["\'][^>]*>', re.IGNORECASE
)
_CONTENT = re.compile(r'content=["\']([^"\']+)["\']', re.IGNORECASE)


def page_pictures(page_url: str, body: str) -> list[str]:
    """The pictures a page names as its own, in its order."""
    found = []
    for tag in _OG_IMAGE.findall(body):
        content = _CONTENT.search(tag)
        if content:
            found.append(urllib.parse.urljoin(page_url, content.group(1).replace("&amp;", "&").strip()))
    return list(dict.fromkeys(found))


def _pictures(answer: dict) -> list[str]:
    from app.services.covers import _get

    urls = [u for u in answer.get("images") or [] if isinstance(u, str)]
    for page in [u for u in answer.get("pages") or [] if isinstance(u, str)][:4]:
        if not (_public(page) and _allowed(page)):
            continue
        try:
            body, content_type = _get(page, timeout=15)
        except Exception:
            continue
        if "html" in content_type:
            urls += page_pictures(page, body[:600_000].decode("utf-8", "replace"))
    return [u for u in dict.fromkeys(urls) if _public(u) and _allowed(u)][:_MAX_PICTURES]


# ---------- asking Claude ----------


def _nullable(kind: str) -> dict:
    return {"anyOf": [{"type": kind}, {"type": "null"}]}


_FIND_SYSTEM = (
    "You find book covers for PowerBook, a reading club in Kazakhstan whose members read in Kazakh, Russian and "
    "English. Given a book title as a reader typed it (and the author, when known), use web search to find web "
    "pages for that exact book that show its front cover: bookshop product pages (flip.kz, marwin.kz, meloman.kz, "
    "kitap.kz, litres, ozon, wildberries, labirint, amazon), the publisher's page, Goodreads or LiveLib. Prefer an "
    "edition in the language of the title as typed. Report only pages you actually saw in search results, and "
    "direct image addresses only if you saw them. If the title is not a book you can identify, say not found."
)
_FIND_SCHEMA = {
    "type": "object",
    "properties": {
        "found": {"type": "boolean"},
        "title": _nullable("string"),
        "author": _nullable("string"),
        "pages": {"type": "array", "items": {"type": "string"}},
        "images": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["found", "title", "author", "pages", "images"],
    "additionalProperties": False,
}

_CHECK_SYSTEM = (
    "You check pictures before they go on a reader's bookshelf as a book's cover. Say yes only when the picture "
    "is the flat front cover of the book named (any edition or translation of it), with no other books, hands, "
    "shelves or mockup scenery around it, and the title on it is this book's title. A different book, a "
    "different volume, an author photo, a banner, a box set or a summary of the book is a no."
)
_CHECK_SCHEMA = {
    "type": "object",
    "properties": {
        "front_cover": {"type": "boolean"},
        "same_book": {"type": "boolean"},
        "title_on_cover": _nullable("string"),
    },
    "required": ["front_cover", "same_book", "title_on_cover"],
    "additionalProperties": False,
}


def _is_the_cover(picture: bytes, title: str, author: str | None) -> bool:
    from app.services import claude

    book = f"«{title}»" + (f" by {author}" if author else "")
    answer = claude.ask_json(
        system=_CHECK_SYSTEM,
        prompt=[
            {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                         "data": base64.b64encode(picture).decode("ascii")}},
            {"type": "text", "text": f"Is this the front cover of the book {book}?"},
        ],
        schema=_CHECK_SCHEMA,
        effort="low",
        max_tokens=4000,
    )
    return bool(answer.get("front_cover") and answer.get("same_book"))


def find_cover(query: str, author_hint: str | None) -> tuple[str, str | None, tuple[bytes, bytes]] | None:
    """(picture id, author, (full, small)) for the book, or None. Claude being
    unreachable or out of the day's turns is a quiet None: the painted cover stays."""
    from app.services import claude
    from app.services.covers import _cover_bytes

    if not enabled() or not _take_turn():
        return None
    known = f"Title as typed: {query}" + (f"\nAuthor: {author_hint}" if author_hint else "")
    try:
        answer = claude.ask_json(system=_FIND_SYSTEM, prompt=known, schema=_FIND_SCHEMA, web_search=True,
                                 effort="low", max_tokens=8000)
        if not answer.get("found"):
            return None
        author = (answer.get("author") or "").strip()[:200] or None
        title = (answer.get("title") or "").strip() or query
        for url in _pictures(answer):
            full = _cover_bytes(url, min_width=200)
            if full and _is_the_cover(full, title, author or author_hint):
                return hashlib.md5(url.encode("utf-8")).hexdigest(), author, (full, full)
    except (claude.AiUnavailable, claude.AiRefused):
        return None
    except Exception:
        logger.warning("claude cover lookup failed for %r", query, exc_info=True)
    return None
