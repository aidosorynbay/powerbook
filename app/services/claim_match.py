"""Which archive nicknames look like a reader.

For five years the circles kept their names in spreadsheets, typed by hand by
whoever was keeping the sheet that month: «Сайра», "Saira", "saira_k",
"Saira khanym". A reader rarely remembers which one was theirs, and a plain
substring search cannot see that Сайра and Saira are the same name.

Names are compared on the same script-neutral skeleton book titles use
(app.core.booktitles.match_key), whole and word by word: Сайра finds Saira,
@saira_k finds «Сайра К», and "Madik" finds "madik_o".
"""
from __future__ import annotations

import re
import threading
import time
import uuid
from dataclasses import dataclass
from difflib import SequenceMatcher

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.booktitles import match_key
from app.models.user import User

_WORDS = re.compile(r"[\s_.\-@]+")
# Shorter skeletons ("an", "da") match too much to mean anything.
_MIN = 3
# Below this a pair is a coincidence, not a suggestion.
THRESHOLD = 0.75

_TTL_SECONDS = 300
_cache: dict[str, object] = {"at": 0.0, "ghosts": None}
_lock = threading.Lock()


@dataclass(frozen=True)
class NameKeys:
    whole: frozenset[str]
    words: frozenset[str]


@dataclass(frozen=True)
class Ghost:
    id: uuid.UUID
    username: str
    display_name: str
    person_id: uuid.UUID | None
    keys: NameKeys


def keys(*names: str | None) -> NameKeys:
    """Every name a person goes by, reduced to comparison skeletons."""
    whole: set[str] = set()
    words: set[str] = set()
    for name in names:
        if not name:
            continue
        key = match_key(name.strip().lstrip("@"))
        if len(key) >= _MIN:
            whole.add(key)
        for part in _WORDS.split(name):
            word = match_key(part)
            if len(word) >= _MIN:
                words.add(word)
    return NameKeys(frozenset(whole), frozenset(words))


def score(a: NameKeys, b: NameKeys) -> float:
    """How surely two sets of names are one person, 0..1."""
    if a.whole & b.whole:
        return 1.0
    best = 0.0
    # A shared first name or surname of some length: «Сайра Кенже» and "saira".
    if any(len(w) >= 4 for w in a.words & b.words):
        best = 0.85
    for x in a.whole:
        for y in b.whole:
            if min(len(x), len(y)) >= 4 and (x in y or y in x):
                best = max(best, 0.8)
            matcher = SequenceMatcher(None, x, y)
            if matcher.real_quick_ratio() < 0.84 or matcher.quick_ratio() < 0.84:
                continue
            ratio = matcher.ratio()
            if ratio >= 0.84:
                best = max(best, round(ratio * 0.9, 3))
    return best


def query_matches(query_key: str, ghost: Ghost) -> int:
    """Rank of a typed search against an archive name: 0 no match, higher is better."""
    if not query_key:
        return 0
    if query_key in ghost.keys.whole:
        return 3
    if any(w.startswith(query_key) for w in ghost.keys.words) or any(k.startswith(query_key) for k in ghost.keys.whole):
        return 2
    if len(query_key) >= 3 and any(query_key in k for k in ghost.keys.whole):
        return 1
    return 0


def claimable_ghosts(db: Session) -> list[Ghost]:
    """Every archive account, with its name skeletons. Kept per process for a
    few minutes: the archive itself does not change, only who claims it."""
    cached = _cache.get("ghosts")
    if cached is not None and time.monotonic() - float(_cache["at"]) < _TTL_SECONDS:
        return cached  # type: ignore[return-value]
    with _lock:
        cached = _cache.get("ghosts")
        if cached is not None and time.monotonic() - float(_cache["at"]) < _TTL_SECONDS:
            return cached  # type: ignore[return-value]
        rows = db.execute(
            select(User.id, User.username, User.display_name, User.person_id).where(User.is_claimable.is_(True))
        ).all()
        ghosts = [
            Ghost(id=r[0], username=r[1], display_name=r[2] or r[1], person_id=r[3], keys=keys(r[1], r[2]))
            for r in rows
        ]
        _cache["ghosts"], _cache["at"] = ghosts, time.monotonic()
        return ghosts


def invalidate() -> None:
    _cache["ghosts"] = None
