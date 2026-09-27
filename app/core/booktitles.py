"""Book-title matching that survives how people actually type titles.

Three things split one book into several in the real data:

  тастамашы ана / тастамашы, ана / тастамашы, ана!   punctuation
  кемел адам / "кемел адам"                          quotes
  ризық / rizyq                                      script

The last one matters most here: Kazakh gets written in both Cyrillic and
Latin, and Russian titles get transliterated too, so the same book lands in
two groups that never meet. Titles are therefore reduced to a script-neutral
skeleton before comparison, while the original text is left untouched for
display.
"""
from __future__ import annotations

import re
import unicodedata

# Cyrillic to Latin, chosen so the common spellings collide rather than to be
# a faithful romanisation: щ/ш both become "sh", ы/і/и all become "i", because
# that is how people vary in practice.
_CYR = {
    "а": "a", "ә": "a", "б": "b", "в": "v", "г": "g", "ғ": "g", "д": "d",
    "е": "e", "ё": "e", "ж": "j", "з": "z", "и": "i", "й": "i", "к": "k",
    "қ": "q", "л": "l", "м": "m", "н": "n", "ң": "n", "о": "o", "ө": "o",
    "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ұ": "u", "ү": "u",
    "ф": "f", "х": "h", "һ": "h", "ц": "c", "ч": "ch", "ш": "sh", "щ": "sh",
    "ъ": "", "ы": "i", "і": "i", "ь": "", "э": "e", "ю": "u", "я": "a",
}

# Latin spellings that vary but mean the same sound.
_LATIN_FOLD = [
    ("kh", "h"), ("gh", "g"), ("zh", "j"), ("ts", "c"),
    ("yi", "i"), ("iy", "i"), ("yu", "u"), ("ya", "a"), ("y", "i"),
    ("q", "q"), ("w", "v"), ("x", "ks"),
]

# Titles that are genuinely different words for the same book. Kept small and
# explicit: guessing translations automatically would merge unrelated books,
# which is worse than missing a match.
_ALIASES: dict[str, str] = {}
_ALIAS_SOURCE = [
    ("atomic habits", "атомные привычки", "атомды әдеттер"),
    ("the alchemist", "алхимик"),
    ("rich dad poor dad", "богатый папа бедный папа"),
    ("the richest man in babylon", "самый богатый человек в вавилоне"),
    ("sapiens", "сапиенс"),
    ("1984", "тысяча девятьсот восемьдесят четыре"),
    ("the kite runner", "бегущий за ветром"),
    ("a thousand splendid suns", "тысяча сияющих солнц"),
    ("pride and prejudice", "гордость и предубеждение"),
    ("and then there were none", "десять негритят"),
    ("martin eden", "мартин иден"),
    ("the subtle art of not giving a f*ck", "тонкое искусство пофигизма"),
    ("anxious people", "тревожные люди"),
    ("shantaram", "шантарам"),
    ("man's search for meaning", "сказать жизни да"),
    ("death on the nile", "смерть на ниле"),
    ("the abc murders", "убийство по алфавиту"),
    ("three comrades", "три товарища"),
    ("arch of triumph", "триумфальная арка"),
    ("the night in lisbon", "ночь в лиссабоне"),
    ("forty rules of love", "сорок правил любви", "40 правил любви"),
]


def _strip_accents(text: str) -> str:
    return "".join(ch for ch in unicodedata.normalize("NFD", text)
                   if unicodedata.category(ch) != "Mn")


def match_key(title: str) -> str:
    """A script-neutral skeleton used only for comparison, never for display."""
    text = title.strip().split("\n", 1)[0].lower()

    # Drop trailing asides such as "(второй раз)" before anything else.
    while True:
        stripped = re.sub(r"\s*[\(\[][^\(\)\[\]]*[\)\]]\s*$", "", text)
        if stripped == text:
            break
        text = stripped.strip()

    text = _strip_accents(text) if not any(c in text for c in "әғқңөұүі") else text
    text = "".join(_CYR.get(ch, ch) for ch in text)

    for a, b in _LATIN_FOLD:
        text = text.replace(a, b)

    # Everything that is not a letter or digit is noise: quotes, commas,
    # dashes and the exclamation marks people add to titles.
    text = re.sub(r"[^a-z0-9]+", "", text)
    return text


def _build_aliases() -> None:
    for group in _ALIAS_SOURCE:
        canonical = match_key(group[0])
        for variant in group:
            _ALIASES[match_key(variant)] = canonical


_build_aliases()


# A comment of "✅" or "👍" carries no title. Those reduce to an empty or
# near-empty key, and treating them as equal would report readers as sharing
# a book when all they shared was a tick mark.
_MIN_KEY = 3


# People write the day's comment, not a title field: some type "Хайди" кітабы,
# some write three sentences about what the book did to them. A whole paragraph
# used as a comparison key can only ever match itself, which is why so many
# finished books in the data have exactly one reader.
_QUOTED = re.compile(r"[\u00ab\u201c\"']([^\u00bb\u201d\"']{3,120})[\u00bb\u201d\"']")

# Above this a first line is an impression rather than a title.
_TITLE_MAX_CHARS = 70
_TITLE_MAX_WORDS = 10


def matching_title(raw: str) -> str | None:
    """The part of a finished-day comment that can stand as a book title.

    A quoted fragment wins: whoever wrote «Грозовой перевал» Эмили Бронте told
    us exactly which part is the title. Failing that, a short first line is
    taken at face value. A long one is left alone and matches nothing —
    reporting two readers as sharing a book because they wrote similar
    paragraphs would be worse than reporting no match at all.
    """
    first = raw.strip().split("\n", 1)[0].strip()
    if not first:
        return None

    quoted = _QUOTED.findall(first)
    if quoted:
        return max(quoted, key=len).strip()

    if len(first) <= _TITLE_MAX_CHARS and len(first.split()) <= _TITLE_MAX_WORDS:
        return first
    return None


def matching_key(raw: str) -> str | None:
    """Comparison key for reader-to-reader matching, or None when the comment
    holds no usable title."""
    title = matching_title(raw)
    return canonical_key(title) if title else None


def canonical_key(title: str) -> str | None:
    """Comparison key, or None when the text holds no recognisable title.

    Known translations are folded onto one canonical form; anything too short
    to be a title returns None so it matches nothing, including itself.
    """
    key = match_key(title)
    if len(key) < _MIN_KEY:
        return None
    return _ALIASES.get(key, key)
