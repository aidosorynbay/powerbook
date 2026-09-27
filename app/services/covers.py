"""Proper titles and real covers for the books on PowerBook shelves.

Readers type a title the way anyone types at the end of a long read —
"Теори игр (наконееееец)". The shelf wants the book: «Теория игр», its
author, its cover. This module cleans what was typed, searches Google Books
for it, and keeps what it finds only when the match is close enough to be
plainly the same book. A wrong cover is worse than a painted one, so the
bar is set high and anything below it keeps the painted edition.

Google's JSON API no longer answers without a key (the shared anonymous
quota is permanently exhausted), so this reads the older public Atom feed,
which still does. Images are fetched once and kept on disk, served from our
own domain: the 3D shelf reads their pixels, which a cross-origin image
would forbid, and a cover must not vanish when someone else's CDN changes.

    python -m app.services.covers backfill                  # every title not yet looked up
    python -m app.services.covers backfill --retry-misses   # and every miss again
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
import threading
import time
import unicodedata
import uuid
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Callable

from sqlalchemy import and_, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.booktitles import match_key, matching_title
from app.core.config import settings
from app.models.book_cover import BookCover

COVERS_DIR = Path(settings.library_storage_dir).parent / "covers"
IMAGE_NAME = re.compile(r"^[0-9a-f]{32}(-s)?\.jpg$")

_FEED = "https://www.google.com/books/feeds/volumes"
_API = "https://www.googleapis.com/books/v1/volumes"
_OPEN_LIBRARY = "https://openlibrary.org/search.json"
_UA = {"User-Agent": "Mozilla/5.0 (compatible; PowerBookCovers/1.0; +https://powerbook.kz)"}
_NS = {"a": "http://www.w3.org/2005/Atom", "dc": "http://purl.org/dc/terms"}

# Politeness: one search a second per process, and one process searching at
# a time. Shelves are opened far less often than that.
_GAP_SECONDS = 1.1
_lock = threading.Lock()
_last_request = [0.0]

# Once the keyed API says the day's quota is spent, stop asking it until
# tomorrow and use the feed instead.
_api_resting_until = [0.0]

# ---------- what a title is ----------

_ASIDE = re.compile(r"\s*[\(\[\{][^\(\)\[\]\{\}]*[\)\]\}]")
_TRIM = " \t.,;:!?-—–…*~_/|\"'«»“”„‘’"

# "Завершил чтение книги …", "Дочитала: …" — the day's words before the title.
_LEADING = re.compile(
    r"^(?:я\s+)?(?:(?:до|про)?читал[аи]?|завершил[аи]?\s+чтение|закончил[аи]?(?:\s+читать)?|"
    r"оқып\s+бітірдім|бітірдім|оқыдым|finished(?:\s+reading)?|just\s+finished)"
    r"(?:\s+(?:книгу|книги|кітабын|кітапты|the\s+book))?\s*[:\-—–]?\s+",
    re.IGNORECASE,
)
# "9/10", "9.2/10", "10 из 10" — a verdict, not part of the name.
_RATING = re.compile(r"\s*[-—–(]?\s*\b\d{1,2}(?:[.,]\d{1,2})?\s*/\s*10\b\)?|\s*\b\d{1,2}\s*из\s*10\b", re.IGNORECASE)
_EMOTICON = re.compile(r"\s*(?:[:;=]-?[()DPpОО3]+|\){2,}|\(+)\s*$")
# "2 часть", "том 1", "1-бөлім": right to keep on the spine, wrong to search with.
_VOLUME = re.compile(
    r"\s*(?:\d+\s*[-‐]?\s*(?:часть|том|книга|бөлім|кітап)|(?:часть|том|книга|бөлім|part|vol\.?|volume|book)\s*\d+)\s*$",
    re.IGNORECASE,
)
# A title and its author joined by a dash, with space on at least one side.
_DASH = re.compile(r"\s+(?:--|[-—–])\s*|\s*(?:--|[-—–])\s+")

# Things people write on the day they finish that are not a book's name.
_NOT_TITLES = {
    match_key(w)
    for w in (
        "дочитала", "дочитал", "прочитала", "прочитал", "закончила", "закончил", "конец", "финиш",
        "ура", "всё", "книга", "кітап", "оқып бітірдім", "бітірдім", "оқыдым", "done", "finished",
        "finish", "the end", "book", "anonymous book",
    )
}

# Editions that are about a book rather than the book.
_DERIVATIVE = re.compile(
    r"кратк|изложени|саммари|summary|конспект|пересказ|анализ книги|по книге|workbook|study guide|"
    r"резюме|summarized|рабочая тетрадь|аудиокнига|audiobook|sparknotes|cliffsnotes",
    re.IGNORECASE,
)


def _is_symbol(ch: str) -> bool:
    # Emoji, pictographs, the variation selector and joiners that glue them.
    return unicodedata.category(ch) in ("So", "Sk", "Cs", "Co", "Cf") or ch in "️⃣"


def clean_title(raw: str) -> str | None:
    """A title fit for a cover, or None when the text isn't one.

    "Теори игр (наконееееец)" → "Теори игр", "Eat that frog 7/10" → "Eat
    that frog", "Завершил чтение книги Волоколамское шоссе" → "Волоколамское
    шоссе". Asides, verdicts, emoji and the exclamation marks of relief all
    go; the reader's words themselves stay — correcting them is the lookup's
    job, and only when it is sure.
    """
    title = matching_title(raw or "")
    if not title:
        return None
    title = "".join(ch for ch in title if not _is_symbol(ch))
    previous = None
    while previous != title:
        previous = title
        title = _ASIDE.sub(" ", title)
        title = _RATING.sub(" ", title)
        title = _EMOTICON.sub("", title)
        title = _LEADING.sub("", title.strip())
    title = re.sub(r"\s+", " ", title).strip(_TRIM)
    key = match_key(title)
    if len(key) < 3 or key in _NOT_TITLES:
        return None
    return title[0].upper() + title[1:]


def _script(text: str) -> str:
    cyr = sum(1 for ch in text if "Ѐ" <= ch <= "ӿ")
    lat = sum(1 for ch in text if ch.isascii() and ch.isalpha())
    return "cyr" if cyr >= lat else "lat"


def cover_key(title: str) -> str:
    """One lookup per title and per script: "Абай жолы" and "Abai joly"
    skeletonise alike, but each should show its own edition."""
    return f"{_script(title)}:{match_key(title)}"[:300]


# ---------- searching ----------


@dataclass
class _Candidate:
    volume_id: str
    titles: list[str]
    creators: list[str]
    has_thumbnail: bool
    source: str = "google"
    isbns: list[str] = field(default_factory=list)


def _get(url: str, timeout: int = 15) -> tuple[bytes, str]:
    request = urllib.request.Request(url, headers=_UA)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read(), response.headers.get("Content-Type", "")


def _paced(url: str) -> bytes:
    with _lock:
        wait = _last_request[0] + _GAP_SECONDS - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        try:
            return _get(url)[0]
        finally:
            _last_request[0] = time.monotonic()


def _search_api(query: str, key: str) -> list[_Candidate]:
    body = _paced(f"{_API}?" + urllib.parse.urlencode({"q": query, "maxResults": 20, "printType": "books", "key": key}))
    found = []
    for item in json.loads(body).get("items", []):
        info = item.get("volumeInfo", {})
        if not info.get("title"):
            continue
        found.append(
            _Candidate(
                volume_id=item["id"],
                titles=[info["title"]] + ([info["subtitle"]] if info.get("subtitle") else []),
                creators=list(info.get("authors") or []),
                has_thumbnail=bool(info.get("imageLinks")),
                isbns=[
                    x["identifier"]
                    for x in info.get("industryIdentifiers") or []
                    if x.get("type") in ("ISBN_13", "ISBN_10") and x.get("identifier")
                ],
            )
        )
    return found


def _search_feed(query: str) -> list[_Candidate]:
    root = ET.fromstring(_paced(f"{_FEED}?" + urllib.parse.urlencode({"q": query, "max-results": 20})))
    found = []
    for entry in root.findall("a:entry", _NS):
        entry_id = entry.find("a:id", _NS)
        titles = [t.text for t in entry.findall("dc:title", _NS) if t.text]
        if entry_id is None or not entry_id.text or not titles:
            continue
        found.append(
            _Candidate(
                volume_id=entry_id.text.rsplit("/", 1)[-1],
                titles=titles,
                creators=[c.text for c in entry.findall("dc:creator", _NS) if c.text],
                has_thumbnail=any(
                    (link.get("rel") or "").endswith("/thumbnail") for link in entry.findall("a:link", _NS)
                ),
                isbns=[
                    i.text[5:]
                    for i in entry.findall("dc:identifier", _NS)
                    if i.text and i.text.startswith("ISBN:")
                ],
            )
        )
    return found


def _search(query: str) -> list[_Candidate]:
    """Google Books: the keyed JSON API when there is a key and quota left,
    otherwise the public feed — the same catalogue, a thinner interface."""
    key = settings.google_books_api_key
    if key and time.time() > _api_resting_until[0]:
        try:
            return _search_api(query, key)
        except urllib.error.HTTPError as exc:
            if exc.code in (403, 429):
                _api_resting_until[0] = time.time() + 6 * 3600
        except Exception:
            pass
    return _search_feed(query)


def _search_open_library(query: str) -> list[_Candidate]:
    """Open Library knows English-language books Google files oddly."""
    body = _paced(
        f"{_OPEN_LIBRARY}?"
        + urllib.parse.urlencode({"q": query, "limit": 10, "fields": "title,subtitle,author_name,cover_i"})
    )
    found = []
    for doc in json.loads(body).get("docs", []):
        if not doc.get("title") or not doc.get("cover_i"):
            continue
        found.append(
            _Candidate(
                volume_id=str(doc["cover_i"]),
                titles=[doc["title"]] + ([doc["subtitle"]] if doc.get("subtitle") else []),
                creators=list(doc.get("author_name") or []),
                has_thumbnail=True,
                source="openlibrary",
            )
        )
    return found


# Where an edition's subtitle starts: ". Как приобрести…", ": A Brief
# History", " — роман", " (", " [". A dot followed by a lowercase word is
# part of the title ("Думай медленно... решай быстро"), not the end of it.
_SUBTITLE = re.compile(r"(?<!\.)\.\s+(?=[A-ZА-ЯЁӘҒҚҢӨҰҮҺІ])|:\s+| [—–-] |\s[\(\[]")


def _head(title: str) -> str:
    """The title without the subtitle an edition bolts on."""
    head = _SUBTITLE.split(title, maxsplit=1)[0]
    return head.strip(_TRIM) or title


def _same_words(ours: str, theirs: str) -> bool:
    """The same title, allowing a typo in a word but not a different word:
    "Теори игр" is «Теория игр», "Тревожные люди" is not «Тревожные годы»."""
    a = [match_key(w) for w in re.split(r"[\s,.:;!?—–-]+", ours) if match_key(w)]
    b = [match_key(w) for w in re.split(r"[\s,.:;!?—–-]+", theirs) if match_key(w)]
    if len(a) != len(b) or not a:
        return False
    for x, y in zip(a, b):
        if x == y:
            continue
        if min(len(x), len(y)) < 4 or SequenceMatcher(None, x, y).ratio() < 0.8:
            return False
    return True


def _same_word_set(ours: str, theirs: str) -> bool:
    a = sorted(match_key(w) for w in re.split(r"[\s,.:;!?—–-]+", ours) if match_key(w))
    b = sorted(match_key(w) for w in re.split(r"[\s,.:;!?—–-]+", theirs) if match_key(w))
    return len(a) >= 3 and a == b


def _author_in(rest_key: str, author: str) -> bool:
    """Whether a leftover piece of the reader's title (as a skeleton) names
    the edition's author — allowing a slip of the keyboard, since "Хэл
    Элорд" is plainly Хэл Элрод."""
    if not rest_key or len(rest_key) > 40:
        return False
    for token in (match_key(t) for t in re.split(r"[\s,.]+", author)):
        if len(token) < 4:
            continue
        if token in rest_key:
            return True
        for i in range(0, max(1, len(rest_key) - len(token) + 1)):
            if SequenceMatcher(None, token, rest_key[i : i + len(token)]).ratio() >= 0.8:
                return True
    return False


def _pick_author(creators: list[str], script: str) -> str | None:
    # A transliterated name on a Cyrillic title reads as a mistake, so only
    # an author written the way the title is.
    same = [c.strip() for c in creators if c.strip() and _script(c) == script]
    return same[0][:200] if same else None


@dataclass
class _Match:
    candidate: _Candidate
    score: float
    title: str | None
    author: str | None


def _judge(query: str, author_hint: str | None, candidate: _Candidate) -> _Match | None:
    if _DERIVATIVE.search(" ".join(candidate.titles + candidate.creators)):
        return None
    head = _head(candidate.titles[0])
    ours, theirs = match_key(query), match_key(head)
    whole = {match_key(candidate.titles[0]), match_key(" ".join(candidate.titles))}
    if not ours or not theirs:
        return None
    ratio = SequenceMatcher(None, ours, theirs).ratio()
    script = _script(query)
    author = _pick_author(candidate.creators, script)
    # Catalogues sometimes SHOUT a title; that is no improvement on the reader's.
    shouted = sum(ch.isalpha() for ch in head) > 3 and head.upper() == head
    same_script = _script(head) == script and not shouted
    all_authors = " ".join(candidate.creators)
    title = None

    if ours == theirs:
        # The same title. Take the edition's capital letters only if the
        # reader typed none of their own — "мастер и маргарита" gains its
        # names, "Гарри Поттер и тайная комната" keeps its Russian casing
        # rather than a catalogue's Every Word Capitalised. Punctuation stays
        # the reader's: their "…" is not a typo.
        letters = lambda t: re.sub(r"[^\w]", "", t)
        typed_lowercase = query[1:] == query[1:].lower()
        if same_script and typed_lowercase and letters(head) != letters(query) and letters(head).lower() == letters(query).lower():
            title = head
    elif ours in whole:
        # The reader wrote the subtitle too: "Поток: Психология оптимального переживания".
        pass
    elif ratio >= 0.84 and _same_words(query, head):
        # The same words with a typo in one of them: "Теори игр".
        if same_script:
            title = head
    elif _same_word_set(query, head):
        # The same words, remembered in another order: "Думай как мужчина,
        # поступай как женщина" is «Поступай как женщина, думай как мужчина».
        if same_script:
            title = head
    elif len(theirs) >= 6 and ours.startswith(theirs) and _author_in(ours[len(theirs):], all_authors):
        # The author after the title: "Атомные привычки Клир", "Код да Винчи. Дэн Браун".
        title = head if same_script else None
    elif len(theirs) >= 6 and ours.endswith(theirs) and _author_in(ours[: -len(theirs)], all_authors):
        # The author before it: "Элбом М.: Вторники с Морри".
        title = head if same_script else None
    elif len(ours) >= 6 and theirs.startswith(ours) and len(theirs) - len(ours) <= 8:
        # The edition adds a volume or a year; the reader's title is the better one.
        pass
    else:
        return None

    score = ratio + (0.1 if author else 0) + (0.05 if candidate.has_thumbnail else 0)
    if author_hint and _author_in(match_key(author_hint), all_authors):
        score += 0.2
    return _Match(candidate=candidate, score=score, title=title, author=author)


def _split_author(query: str, candidate: _Candidate) -> _Match | None:
    """"Мастер и Маргарита - Булгаков" or "Булгаков — Мастер и Маргарита":
    one side is the title, the other must be the edition's author for the
    split to count — otherwise it may just be a subtitle."""
    parts = _DASH.split(query)
    if len(parts) != 2:
        return None
    for title_part, author_part in (parts, parts[::-1]):
        match = _judge(title_part, None, candidate)
        if match and _author_in(match_key(author_part), " ".join(candidate.creators)):
            match.title = match.title or title_part
            match.score += 0.1
            return match
    return None


# ---------- Wikidata: famous books Google files badly ----------

_WIKIDATA = "https://www.wikidata.org/w/api.php"
# Literary work, novel, book, written work, novella, short story, poem,
# literary series, novel series.
_WORK_CLASSES = {"Q7725634", "Q8261", "Q571", "Q47461344", "Q149537", "Q49084", "Q5185279", "Q1667921", "Q277759"}


def _wikidata_cover(query: str) -> tuple[_Match, tuple[bytes, bytes]] | None:
    """A cover from the book's Wikipedia article, for well-known titles —
    classics and bestsellers whose translations Google holds no picture of.
    Only an item that is a literary work and whose name is the reader's
    title counts."""
    lang = "ru" if _script(query) == "cyr" else "en"
    found = json.loads(
        _paced(
            f"{_WIKIDATA}?"
            + urllib.parse.urlencode(
                {"action": "wbsearchentities", "search": query, "language": lang, "uselang": lang,
                 "type": "item", "limit": 7, "format": "json"}
            )
        )
    ).get("search", [])
    ours = match_key(query)
    ids = [x["id"] for x in found if match_key(x.get("label", "")) == ours or match_key(x.get("match", {}).get("text", "")) == ours]
    if not ids:
        return None
    entities = json.loads(
        _paced(
            f"{_WIKIDATA}?"
            + urllib.parse.urlencode(
                {"action": "wbgetentities", "ids": "|".join(ids[:5]), "props": "claims|sitelinks|labels", "format": "json"}
            )
        )
    ).get("entities", {})
    for qid in ids[:5]:
        entity = entities.get(qid, {})
        claims = entity.get("claims", {})
        kinds = {c["mainsnak"].get("datavalue", {}).get("value", {}).get("id") for c in claims.get("P31", [])}
        if not kinds & _WORK_CLASSES:
            continue
        urls = []
        for claim in claims.get("P18", [])[:1]:
            name = claim["mainsnak"].get("datavalue", {}).get("value")
            if name:
                urls.append(f"https://commons.wikimedia.org/wiki/Special:FilePath/{urllib.parse.quote(name)}?width=600")
        # The article's own infobox picture. Book covers on Wikipedia are
        # non-free files, which the page-images API leaves out, so the page
        # property naming the picture is read instead.
        for wiki in dict.fromkeys((f"{lang}wiki", "enwiki", "ruwiki")):
            page = entity.get("sitelinks", {}).get(wiki, {}).get("title")
            if not page:
                continue
            api = f"https://{wiki[:-4]}.wikipedia.org/w/api.php?"
            props = json.loads(
                _paced(api + urllib.parse.urlencode(
                    {"action": "query", "titles": page, "prop": "pageprops", "ppprop": "page_image", "redirects": 1, "format": "json"}
                ))
            )
            image = next(iter(props.get("query", {}).get("pages", {}).values()), {}).get("pageprops", {}).get("page_image")
            if not image:
                continue
            info = json.loads(
                _paced(api + urllib.parse.urlencode(
                    {"action": "query", "titles": f"File:{image}", "prop": "imageinfo", "iiprop": "url|mime",
                     "iiurlwidth": 600, "format": "json"}
                ))
            )
            file_info = (next(iter(info.get("query", {}).get("pages", {}).values()), {}).get("imageinfo") or [{}])[0]
            if file_info.get("mime") == "image/jpeg":
                urls.append(file_info.get("thumburl") or file_info.get("url"))
        for url in urls:
            full = _cover_bytes(url, min_width=200)
            if full:
                label = entity.get("labels", {}).get(lang, {}).get("value")
                candidate = _Candidate(volume_id=qid, titles=[label or query], creators=[], has_thumbnail=True, source="wikidata")
                return _Match(candidate=candidate, score=1.0, title=None, author=None), (full, full)
    return None


# ---------- images ----------


def _jpeg_size(data: bytes) -> tuple[int, int] | None:
    """Width and height from a JPEG's frame header, without an image library."""
    if data[:2] != b"\xff\xd8":
        return None
    i = 2
    while i + 9 < len(data):
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            h = int.from_bytes(data[i + 5 : i + 7], "big")
            w = int.from_bytes(data[i + 7 : i + 9], "big")
            return w, h
        i += 2 + int.from_bytes(data[i + 2 : i + 4], "big")
    return None


def _cover_bytes(url: str, *, min_width: int, portrait: bool = True) -> bytes | None:
    """The image at url if it is a real book cover.

    Google answers a missing cover with a small "no image" PNG, and an
    audiobook edition with a square picture; neither belongs on a book.
    """
    try:
        data, content_type = _get(url)
    except Exception:
        return None
    if "jpeg" not in content_type or len(data) < 3000:
        return None
    size = _jpeg_size(data)
    if not size or size[0] < min_width:
        return None
    aspect = size[1] / max(1, size[0])
    if portrait and not 1.2 <= aspect <= 1.9:
        return None
    return data


def _fetch_images(candidate: _Candidate, min_width: int = 250) -> tuple[bytes, bytes] | None:
    if candidate.source == "openlibrary":
        base = f"https://covers.openlibrary.org/b/id/{urllib.parse.quote(candidate.volume_id)}"
        full = _cover_bytes(f"{base}-L.jpg", min_width=min_width)
        if not full:
            return None
        return full, _cover_bytes(f"{base}-M.jpg", min_width=60, portrait=False) or full

    quoted = urllib.parse.quote(candidate.volume_id)
    full = None
    if candidate.has_thumbnail:
        full = _cover_bytes(
            f"https://books.google.com/books/publisher/content/images/frontcover/{quoted}?fife=w600-h900&source=gbs_api",
            min_width=min_width,
        ) or _cover_bytes(
            f"https://books.google.com/books/content?id={quoted}&printsec=frontcover&img=1&zoom=3&source=gbs_api",
            min_width=min_width,
        )
    if not full:
        # Google knows the edition but has no picture of it; Open Library
        # often does, filed under the same ISBN.
        for isbn in candidate.isbns[:3]:
            base = f"https://covers.openlibrary.org/b/isbn/{urllib.parse.quote(isbn)}"
            full = _cover_bytes(f"{base}-L.jpg?default=false", min_width=min_width)
            if full:
                small = _cover_bytes(f"{base}-M.jpg?default=false", min_width=60, portrait=False)
                return full, small or full
        return None
    small = _cover_bytes(
        f"https://books.google.com/books/content?id={quoted}&printsec=frontcover&img=1&zoom=1&source=gbs_api",
        min_width=60,
        portrait=False,
    )
    return full, small or full


def _store(key: str, volume_id: str, images: tuple[bytes, bytes]) -> str:
    # Named by title and edition, so a better match later gets a new name
    # and browsers never keep showing the old picture from cache.
    name = hashlib.md5(f"{key}|{volume_id}".encode("utf-8")).hexdigest()
    COVERS_DIR.mkdir(parents=True, exist_ok=True)
    (COVERS_DIR / f"{name}.jpg").write_bytes(images[0])
    (COVERS_DIR / f"{name}-s.jpg").write_bytes(images[1])
    return name


def store_images(images: tuple[bytes, bytes]) -> str:
    """Keep a reader's own pick or photo under a fresh, unguessable name."""
    name = uuid.uuid4().hex
    COVERS_DIR.mkdir(parents=True, exist_ok=True)
    (COVERS_DIR / f"{name}.jpg").write_bytes(images[0])
    (COVERS_DIR / f"{name}-s.jpg").write_bytes(images[1])
    return name


def delete_image(name: str) -> None:
    if not re.match(r"^[0-9a-f]{32}$", name or ""):
        return
    for suffix in (".jpg", "-s.jpg"):
        try:
            (COVERS_DIR / f"{name}{suffix}").unlink(missing_ok=True)
        except OSError:
            pass


def jpeg_size(data: bytes) -> tuple[int, int] | None:
    return _jpeg_size(data)


def is_derivative(candidate: _Candidate) -> bool:
    return bool(_DERIVATIVE.search(" ".join(candidate.titles + candidate.creators)))


def search_any(query: str) -> list[_Candidate]:
    """Every edition the catalogues offer for a query, for a reader to choose
    from: Google first, Open Library after it for Latin titles."""
    found = _search(query)
    if _script(query) == "lat":
        try:
            found += _search_open_library(query)
        except Exception:
            pass
    return found


def fetch_edition_images(source: str, volume_id: str) -> tuple[bytes, bytes] | None:
    candidate = _Candidate(volume_id=volume_id, titles=[""], creators=[], has_thumbnail=True, source=source)
    return _fetch_images(candidate) or _fetch_images(candidate, min_width=110)


def resolve_image(name: str) -> Path | None:
    if not IMAGE_NAME.match(name):
        return None
    path = COVERS_DIR / name
    return path if path.is_file() else None


# ---------- the cache ----------

# Enough attempts to get past a page of editions without covers, few enough
# that one stubborn title can't hold up everyone else's.
_MAX_IMAGE_TRIES = 8
# And a clock: past this, settle for what has been found.
_LOOKUP_SECONDS = 40


def _look_up(row: BookCover, author_hint: str | None) -> None:
    query = row.query
    core = _VOLUME.sub("", query).strip(_TRIM) or query

    def judged(candidates: list[_Candidate]) -> list[_Match]:
        found = [m for m in (_judge(core, author_hint, c) or _split_author(core, c) for c in candidates) if m]
        return sorted(found, key=lambda m: m.score, reverse=True)

    # Plainest question first; then the exact title, which digs a popular
    # book's own edition out from under the summaries of it; then each side
    # of a dash on its own, for "Author - Title" in either order.
    searches: list[tuple[str, Callable[[str], list[_Candidate]]]] = [
        (f"{core} {author_hint}" if author_hint else core, _search),
        (f'intitle:"{core}"', _search),
    ]
    parts = _DASH.split(core)
    if len(parts) == 2:
        searches += [(parts[0], _search), (parts[1], _search)]
    if _script(core) == "lat":
        searches.append((core, _search_open_library))

    started = time.monotonic()
    seen: set[tuple[str, str]] = set()
    fallback: _Match | None = None
    with_picture: list[_Match] = []
    tries = 0
    for text, search in searches:
        try:
            candidates = [c for c in search(text) if (c.source, c.volume_id) not in seen]
        except urllib.error.HTTPError:
            raise
        except Exception:
            continue
        seen.update((c.source, c.volume_id) for c in candidates)
        for match in judged(candidates):
            fallback = fallback or match
            if not (match.candidate.has_thumbnail or match.candidate.isbns) or tries >= _MAX_IMAGE_TRIES:
                continue
            if time.monotonic() - started > _LOOKUP_SECONDS:
                break
            with_picture.append(match)
            tries += 1
            images = _fetch_images(match.candidate)
            if images:
                _keep(row, match, images, keep_title=core == query, fallback=fallback)
                return
    # No sharp cover anywhere: a well-known book's Wikipedia article usually
    # shows one; failing that, a small cover still beats a painted stand-in
    # on the shelf, and only looks soft when held right up to the camera.
    try:
        found = _wikidata_cover(core)
    except Exception:
        found = None
    if found:
        match, images = found
        _keep(row, match, images, keep_title=core == query, fallback=fallback)
        return
    for match in with_picture[:3]:
        images = _fetch_images(match.candidate, min_width=110)
        if images:
            _keep(row, match, images, keep_title=core == query, fallback=fallback)
            return
    if fallback:
        _keep(row, fallback, None, keep_title=core == query)
    else:
        row.status = "none"


def _keep(
    row: BookCover,
    match: _Match,
    images: tuple[bytes, bytes] | None,
    *,
    keep_title: bool,
    fallback: _Match | None = None,
) -> None:
    row.title = match.title if keep_title else None
    # The edition with a picture may list no author in the reader's script;
    # the best textual match usually does.
    row.author = match.author or (fallback.author if fallback else None)
    row.source = match.candidate.source
    row.source_id = match.candidate.volume_id
    row.image = _store(row.key, f"{match.candidate.source}:{match.candidate.volume_id}", images) if images else None
    # Matched a record with nothing to show: worth asking again later.
    row.status = "found" if (row.image or row.title or row.author) else "none"


def _claim(db: Session, wanted: dict[str, tuple[str, str | None]]) -> list[str]:
    """Take the keys nobody has looked up — or whose last try is old enough
    to try again — so two server processes never search the same title.

    Postgres re-checks the WHERE of a contended UPDATE after the first one
    commits, so of two processes racing for a row only one gets it back.
    """
    if not wanted:
        return []
    now = datetime.now(timezone.utc)
    db.execute(
        insert(BookCover)
        .values([{"key": k, "query": q[:300], "status": "pending"} for k, (q, _) in wanted.items()])
        .on_conflict_do_nothing(index_elements=["key"])
    )
    due = or_(
        BookCover.status == "pending",
        # A process that died mid-lookup leaves its rows "working"; after half
        # an hour they are fair game again.
        and_(BookCover.status == "working", BookCover.updated_at < now - timedelta(minutes=30)),
        and_(BookCover.status == "error", BookCover.checked_at < now - timedelta(days=1), BookCover.attempts < 5),
        and_(BookCover.status == "none", BookCover.checked_at < now - timedelta(days=60)),
    )
    claimed = (
        db.execute(
            update(BookCover)
            .where(BookCover.key.in_(list(wanted)), due)
            .values(status="working", updated_at=now)
            .returning(BookCover.key)
        )
        .scalars()
        .all()
    )
    db.commit()
    return list(claimed)


def fill(db: Session, wanted: dict[str, tuple[str, str | None]], limit: int = 30) -> tuple[int, int]:
    """Look up to `limit` of the wanted titles. Returns (found, errors)."""
    found = errors = 0
    for key in _claim(db, dict(list(wanted.items())[:limit])):
        row = db.get(BookCover, key)
        if row is None:
            continue
        try:
            _look_up(row, wanted[key][1])
        except Exception:
            row.status = "error"
        row.attempts += 1
        row.checked_at = datetime.now(timezone.utc)
        db.commit()
        if row.status == "found":
            found += 1
        elif row.status == "error":
            errors += 1
            # Google pushing back: give it room rather than hammering on.
            time.sleep(10)
    return found, errors


_filling = threading.Lock()


def fill_in_background(wanted: dict[str, tuple[str, str | None]]) -> None:
    """Entry point for a request's background task: its own session, one
    at a time per process, and never an exception into the request's face.
    Whatever this run doesn't reach, the next shelf visit asks for again."""
    from app.db.session import get_session_factory

    if not wanted or not _filling.acquire(blocking=False):
        return
    db = get_session_factory()()
    try:
        fill(db, wanted)
    except Exception:
        db.rollback()
    finally:
        db.close()
        _filling.release()


def cached(db: Session, keys: list[str]) -> dict[str, BookCover]:
    if not keys:
        return {}
    rows = db.execute(select(BookCover).where(BookCover.key.in_(set(keys)))).scalars().all()
    return {row.key: row for row in rows}


def wants_lookup(row: BookCover | None) -> bool:
    if row is None:
        return True
    if row.status in ("pending",):
        return True
    now = datetime.now(timezone.utc)
    checked = row.checked_at or now
    if row.status == "error":
        return row.attempts < 5 and checked < now - timedelta(days=1)
    if row.status == "none":
        return checked < now - timedelta(days=60)
    return False


# ---------- backfill ----------


def _backfill(retry_misses: bool = False, prune: bool = False) -> None:
    from app.db.session import get_session_factory
    from app.models.library import LibraryBook
    from app.models.manual_book import ManualBook
    from app.models.round import ReadingLog

    db = get_session_factory()()
    wanted: dict[str, tuple[str, str | None]] = {}
    # Titles only, never the rest of a comment; private comments wait until
    # their owner opens the shelf themselves.
    for (comment,) in db.execute(
        select(ReadingLog.comment).where(
            ReadingLog.book_finished.is_(True),
            ReadingLog.comment.is_not(None),
            ReadingLog.is_comment_private.is_(False),
        )
    ).all():
        title = clean_title(comment)
        if title:
            wanted.setdefault(cover_key(title), (title, None))
    for title_raw, author in db.execute(select(ManualBook.title, ManualBook.author)).all():
        title = clean_title(title_raw)
        if title:
            wanted.setdefault(cover_key(title), (title, author))
    for title_raw, author in db.execute(select(LibraryBook.title, LibraryBook.author)).all():
        title = clean_title(title_raw.replace("_", " "))
        if title:
            wanted.setdefault(cover_key(title), (title, author))

    if prune:
        # Rows keyed by titles as they were cleaned before the cleaning got
        # better ("The giver 9.2/10"): nothing looks them up any more.
        stale = [
            row.key
            for row in db.execute(select(BookCover)).scalars().all()
            if row.key not in wanted and clean_title(row.query) != row.query
        ]
        for start in range(0, len(stale), 200):
            for row in db.execute(select(BookCover).where(BookCover.key.in_(stale[start : start + 200]))).scalars():
                if row.image:
                    delete_image(row.image)
                db.delete(row)
        db.commit()
        print(f"pruned {len(stale)} stale rows", flush=True)
    known = cached(db, list(wanted))
    todo = {k: v for k, v in wanted.items() if wants_lookup(known.get(k))}
    if retry_misses:
        # After the matcher learns something new, ask again for every title
        # it missed or found without a picture, not in sixty days' time.
        again = [
            k
            for k in wanted
            if known.get(k) is not None
            and (known[k].status == "none" or (known[k].status == "found" and not known[k].image))
        ]
        db.execute(update(BookCover).where(BookCover.key.in_(again)).values(status="pending"))
        db.commit()
        todo.update({k: wanted[k] for k in again})
    print(f"titles: {len(wanted)}, to look up: {len(todo)}", flush=True)
    done = found = errors = 0
    items = list(todo.items())
    for start in range(0, len(items), 20):
        batch_found, batch_errors = fill(db, dict(items[start : start + 20]), limit=20)
        found += batch_found
        errors += batch_errors
        done += min(20, len(items) - start)
        print(f"  {done}/{len(items)} looked up, {found} found, {errors} errors", flush=True)
        if batch_errors >= 10:
            print("  too many errors in a row, stopping; run again later", flush=True)
            break
    db.close()


if __name__ == "__main__":
    if sys.argv[1:2] == ["backfill"]:
        _backfill(retry_misses="--retry-misses" in sys.argv, prune="--prune" in sys.argv)
    else:
        print(__doc__)
