"""Who wrote a book, as people and catalogues write it.

One book reaches PowerBook with many spellings of its author: «Ремарк» in a
reader's comment, "Эрих Мария Ремарк" from one edition, "Ремарк Э. М." from
another, "Erich Maria Remarque" in a file. And no single source can be
trusted with it. A translated edition lists its translator beside the author,
often in the reader's script while the author is in the original; a search for a
famous title brings up the odd other book that happens to share it; a day's
comment after the title is sometimes a name and sometimes «Перечитала».

So an author is never taken from one source. Names are compared as people —
the same surname, given names and initials free to come or go, either
script — and the person most sources agree on is the book's author, written
the fullest way it was seen in the title's script. «Три товарища» is
Remarque's because that name is on nearly every edition and in readers'
comments, while each translator is on one or two.
"""
from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Callable, Iterable

from app.core.booktitles import match_key

# Words inside a name that are not a name of their own.
_PARTICLES = {
    "de", "da", "di", "du", "del", "della", "der", "den", "van", "von", "le", "la", "el", "al", "ibn", "bin", "ben",
    "фон", "ван", "де", "дер", "ди", "ле", "ла", "ибн", "бен", "аль", "эль",
}
_WORD = re.compile(r"[^\W\d_]+(?:['’-][^\W\d_]+)*\.?", re.UNICODE)
_SPLIT = re.compile(r"[\s,;/]+")


def script_of(text: str) -> str:
    cyr = sum(1 for ch in text if "Ѐ" <= ch <= "ӿ")
    lat = sum(1 for ch in text if ch.isascii() and ch.isalpha())
    return "cyr" if cyr >= lat else "lat"


def _tokens(name: str) -> list[str]:
    """The name's words as script-neutral skeletons; initials and particles
    («Э. М.», «фон») left out, since they come and go between spellings."""
    out = []
    for word in re.split(r"[\s,.;:/()\[\]«»\"“”]+", name or ""):
        if word.casefold() in _PARTICLES:
            continue
        key = match_key(word)
        if len(key) >= 3 and key not in out:
            out.append(key)
    return out


def _alike(a: str, b: str, ratio: float = 0.8) -> bool:
    if a == b:
        return True
    if min(len(a), len(b)) < 4:
        return False
    # "remark" and "remarque": one name, two alphabets.
    if min(len(a), len(b)) >= 5 and a[:5] == b[:5] and abs(len(a) - len(b)) <= 3:
        return True
    return SequenceMatcher(None, a, b).ratio() >= ratio


def same_person(a: str, b: str) -> bool:
    """Whether two spellings name one person: every word of the shorter is
    in the longer («Ремарк» in "Эрих Мария Ремарк"), allowing a slip of the
    keyboard — and, between two full names, one given name written another
    way ("Fyodor" and «Фёдор»), but never two different surnames."""
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return False
    short, long_ = (ta, tb) if len(ta) <= len(tb) else (tb, ta)
    missing = [t for t in short if not any(_alike(t, u) for u in long_)]
    if not missing:
        return True
    if len(short) < 2 or len(missing) > 1:
        return False
    # The one word left must still sound alike, and the rest must hold a real name, not just "Михаил".
    loose = any(_alike(missing[0], u, 0.6) for u in long_)
    held = [t for t in short if t not in missing]
    return loose and any(len(t) >= 5 for t in held)


def looks_like_name(text: str | None, *, capitals: bool = True) -> bool:
    """Whether a reader's few words after a title read as an author:
    «Ремарк», "Эрих Мария Ремарк", "Э. М. Ремарк", "J. K. Rowling" — not
    «перечитала», «очень понравилось» or «9/10». Without `capitals`, a name
    typed in lower case passes too (for when a known author vouches for it)."""
    text = (text or "").strip()
    if not text or len(text) > 60 or any(ch.isdigit() for ch in text):
        return False
    words = [w for w in _SPLIT.split(text) if w]
    if not 1 <= len(words) <= 5:
        return False
    named = 0
    for word in words:
        if word.casefold().strip(".") in _PARTICLES:
            continue
        if not _WORD.fullmatch(word) and not re.fullmatch(r"(?:[^\W\d_]\.){1,3}", word):
            return False
        if capitals and not word[0].isupper():
            return False
        if len(word.strip(".")) >= 3 and "." not in word:
            named += 1
    return named >= 1


def _full_words(name: str) -> int:
    return sum(1 for w in _SPLIT.split(name) if len(w.strip(".")) >= 3 and "." not in w)


@dataclass
class Person:
    """One author and every spelling of their name seen, heaviest first."""

    names: list[str]
    weight: float = 0.0
    first_seen: int = 0
    by_name: dict[str, float] = field(default_factory=dict)

    def is_(self, name: str | None) -> bool:
        return bool(name) and any(same_person(name, n) for n in self.names[:4])

    def written(self, script: str | None = None) -> str | None:
        """The name to print: in the title's script when it was ever seen so,
        the fullest form («Эрих Мария Ремарк» over «Ремарк»), then the most
        said."""
        names = [n for n in self.names if script is None or script_of(n) == script]
        if not names:
            return None
        return max(names, key=lambda n: (_full_words(n), self.by_name.get(n, 0.0), len(n)))[:200]


def people(votes: Iterable[tuple[str, float]], prominence: Callable[[str], int] | None = None) -> list[Person]:
    """Spellings with their weight, gathered into people, the most agreed on
    first. At a tie, the better-known author (`prominence`: how many books
    the library knows by them) and then the one heard first."""
    weight: dict[str, float] = defaultdict(float)
    order: dict[str, int] = {}
    for name, w in votes:
        name = re.sub(r"\s+", " ", (name or "").strip(" \t,;.-—–")).strip()
        if not name or not _tokens(name) or w <= 0:
            continue
        weight[name] += w
        order.setdefault(name, len(order))
    found: list[Person] = []
    for name in sorted(weight, key=lambda n: (-weight[n], order[n])):
        person = next((p for p in found if same_person(name, p.names[0])), None)
        if person is None:
            person = Person(names=[], first_seen=order[name])
            found.append(person)
        person.names.append(name)
        person.by_name[name] = weight[name]
        person.weight += weight[name]
        person.first_seen = min(person.first_seen, order[name])
    known = {id(p): prominence(p.names[0]) for p in found} if prominence and len(found) > 1 else {}
    found.sort(key=lambda p: (-round(p.weight, 6), -known.get(id(p), 0), p.first_seen))
    return found


def agreed(votes: Iterable[tuple[str, float]]) -> Person | None:
    found = people(votes)
    return found[0] if found else None


class Directory:
    """Every author name the library has seen, to tell a reader's «Ремарк»
    (a real author, written short) from «Перечитала» (not one) — and to
    lend the short form its full spelling."""

    def __init__(self, names: Iterable[str]) -> None:
        self._count: Counter[str] = Counter(n.strip() for n in names if n and n.strip())
        self._by_head: dict[str, list[str]] = defaultdict(list)
        for name in self._count:
            for token in _tokens(name):
                self._by_head[token[:5]].append(name)

    def find(self, name: str | None) -> list[str]:
        """Known spellings of the person `name` names."""
        if not name:
            return []
        seen: dict[str, None] = {}
        for token in _tokens(name):
            for known in self._by_head.get(token[:5], ()):
                if known not in seen and same_person(name, known):
                    seen[known] = None
        return list(seen)

    def prominence(self, name: str | None) -> int:
        """How many times the library met this person as an author."""
        return sum(self._count[k] for k in self.find(name))
