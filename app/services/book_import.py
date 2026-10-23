"""«Вставить список»: a reader pastes the books they have read, as text, and the ones missing from their shelf go on it.

The founder (2026-10-23): everyone has a list somewhere — a note on the phone, a Telegram message, a spreadsheet — and
typing it in one book at a time is what stops them. The list is read line by line, each line is matched to the shared
library where it can be (so «три товарища» is «Три товарища» by Ремарк), and the reader sees what will be added and
what is already on the shelf before anything is written. A photo of a list (later) only has to become this text.

How a line is read (the founder's own list, 2026-10-23, is in tests/test_book_import.py):
  - numbering, bullets, check marks, emoji, markdown, ratings, dates and asides are left out;
  - the title and the author are told apart whichever way round they were typed — «Название — Автор», «Автор —
    Название», «Автор. Название», «Название (Автор)», «Автор «Название»», «Title by Author», a spreadsheet's columns —
    by what the shared library knows: its books and the people who wrote them;
  - a volume of a series is its own book: «Перси Джексон (часть 3)» and «(часть 4)» are two books, «Страна сказок 2»
    is not «Страна сказок». The site compares titles without what is in brackets, so a volume in brackets is written
    down as «Перси Джексон. Часть 3», which it keeps apart;
  - a title made of digits («1984», «2666») is a book, a year standing alone as a heading is not.
"""
from __future__ import annotations

import re
import unicodedata
import uuid
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.manual_book import ManualBook
from app.models.want_book import WantBook
from app.repositories.insights import normalize_book_title
from app.services import book_face, catalog

MAX_BOOKS = 300
MAX_TEXT = 30_000

# ---------- volumes ----------

_ORDINALS = {
    1: ("перв", "first", "бірінші"), 2: ("втор", "second", "екінші"), 3: ("трет", "third", "үшінші"),
    4: ("четв", "fourth", "төртінші"), 5: ("пят", "fifth", "бесінші"), 6: ("шест", "sixth", "алтыншы"),
    7: ("седьм", "seventh", "жетінші"), 8: ("восьм", "eighth", "сегізінші"), 9: ("девят", "ninth", "тоғызыншы"),
    10: ("десят", "tenth", "оныншы"),
}
_ROMAN = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7, "VIII": 8, "IX": 9, "X": 10, "XI": 11, "XII": 12}
_ORD_WORD = r"(?:перв|втор|трет|четв[её]рт|пят|шест|седьм|восьм|девят|десят)[а-яё]{0,3}|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|бірінші|екінші|үшінші|төртінші|бесінші|алтыншы|жетінші|сегізінші|тоғызыншы|оныншы"
_NUM = rf"(?:\d{{1,3}}|[IVX]{{1,4}}|{_ORD_WORD})"
_VOL = r"(?:часть|части|частина|ч\.|том|т\.|книга|книги|кн\.|выпуск|вып\.|сезон|бөлім|бөлімі|кітап|кітабы|part|pt\.|vol\.|vol|volume|book|tome|#|№)"
# «(часть 3)», «(3)», «(книга первая)», «(3 часть)»: a volume in brackets, anywhere in the line
_VOL_PAREN = re.compile(rf"\s*[\(\[]\s*(?:(?P<w>{_VOL})\s*(?P<n>{_NUM})|(?P<n2>{_NUM})(?:\s*-?\s*(?:я|й|ая|ый|ое|ші|шы))?\s*(?P<w2>{_VOL})?)\s*[\)\]]", re.IGNORECASE)
# at the end of a title: «, часть 3», «. Книга 4», « том 2», « #3»
_VOL_WORD_END = re.compile(rf"[\s,.:;—–-]*(?<![^\W\d_])(?P<w>{_VOL})\s*(?P<n>{_NUM})\s*$", re.IGNORECASE)
# «3 часть», «3-я книга», «1-бөлім»
_VOL_NUM_END = re.compile(rf"[\s,.:;—–-]+(?P<n>{_NUM})(?:\s*-?\s*(?:я|й|ая|ый|ое|ші|шы))?\s*-?\s*(?P<w>{_VOL})\s*$", re.IGNORECASE)
# «Страна сказок 2», «Война и мир II», «Гарри Поттер-3» (one digit after a hyphen only: «Уловка-22» is a title)
_VOL_BARE_END = re.compile(r"(?:\s+(?P<n>\d{1,2}|II|III|IV|VI|VII|VIII|IX|X)|-(?P<n2>\d))\s*$")


def _number(text: str | None) -> int | None:
    if not text:
        return None
    t = text.strip().rstrip(".").lower()
    if t.isdigit():
        return int(t)
    if text.strip().upper() in _ROMAN and text.strip().isupper():
        return _ROMAN[text.strip().upper()]
    for n, stems in _ORDINALS.items():
        if any(t.startswith(s) for s in stems):
            return n
    return None


def volume(title: str) -> tuple[str, int | None]:
    """The title without its volume, and the volume: («Перси Джексон. Часть 3» → «Перси Джексон», 3)."""
    t = title.strip()
    for rx in (_VOL_PAREN, _VOL_WORD_END, _VOL_NUM_END, _VOL_BARE_END):
        m = rx.search(t)
        if m is None:
            continue
        if rx is _VOL_PAREN and m.end() != len(t.rstrip()):
            continue
        n = _number(m.groupdict().get("n") or m.groupdict().get("n2"))
        base = t[: m.start()].strip(" ,.:;—–-")
        if n is not None and 0 < n < 200 and re.search(r"[^\W\d_]{2,}", base):
            return base, n
    return t, None


def _is_volume(text: str) -> bool:
    """«часть 3», «3», «книга вторая»: no author, a volume."""
    t = text.strip()
    return bool(re.fullmatch(rf"(?:{_VOL})?\s*{_NUM}(?:\s*-?\s*(?:я|й|ая|ый|ое))?\s*(?:{_VOL})?", t, re.IGNORECASE)) and bool(
        re.search(r"\d|[IVX]|" + _ORD_WORD, t, re.IGNORECASE)
    )


def _unbracket_volume(line: str) -> str:
    """«Перси Джексон (часть 3) — Риордан» → «Перси Джексон. Часть 3 — Риордан»: the site compares titles without
    what is in brackets, and «(часть 3)» and «(часть 4)» became one book."""
    def repl(m: re.Match) -> str:
        word = m.group("w") or m.group("w2")
        num = m.group("n") or m.group("n2")
        if word and word not in ("#", "№"):
            return f". {word[0].upper()}{word[1:].lower()} {num}"
        return f" {num}"

    return _VOL_PAREN.sub(repl, line)


# ---------- cleaning a line ----------

_KEEP_LEAD = set("«\"“„'([")
_RATING = re.compile(
    r"\s*(?:[-–—,:|/]\s*)?(?:\d{1,2}\s*/\s*\d{1,2}|\d{1,2}\s*(?:из|of)\s*\d{1,2}|\d{1,2}\s*(?:балл\w*|звезд\w*|stars?)|оценка\s*:?\s*\d{1,2}|"
    r"[★☆⭐✩✪✫✬✭✮✯]+(?:\s*\d)?|\d\s*[★☆⭐]+)\s*$",
    re.IGNORECASE,
)
_WHEN = (
    r"(?:\d{1,2}[./]\d{1,2}[./]\d{2,4}|"
    r"(?:январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)\w*\.?\s*(?:(?:19|20)\d{2})?)"
)
# when it was read: «(2024)», «(март 2024)», «— 12.03.2024», «, 2023» (a year after a dash only from 2000: «Оруэлл — 1984»
# is a book)
_DATE = re.compile(
    rf"\s*(?:\(\s*(?:{_WHEN}|(?:19|20)\d{{2}}(?:\s*г(?:ода?|\.)?)?)\s*\)|[-–—,:|]\s*(?:{_WHEN}|20[0-4]\d(?:\s*г(?:ода?|\.)?)?))\s*$",
    re.IGNORECASE,
)
_MONTH_LINE = re.compile(
    r"(?:январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр|қаңтар|ақпан|наурыз|сәуір|мамыр|"
    r"маусым|шілде|тамыз|қыркүйек|қазан|қараша|желтоқсан|january|february|march|april|may|june|july|august|"
    r"september|october|november|december)\w*\.?\s*(?:(?:19|20)\d{2}\s*(?:г\.?|год)?)?",
    re.IGNORECASE,
)
_HEADINGS = {
    "книги", "мои книги", "прочитано", "прочитанное", "прочитанные книги", "список", "список книг", "список прочитанного",
    "прочитанные", "кітаптар", "оқылған кітаптар", "оқылғандар", "books", "my books", "read", "reading list", "books read",
}


def _strip_marks(line: str) -> str:
    """Numbering, bullets, check boxes, emoji and markdown before and after the words."""
    t = line.replace("**", "").replace("__", "").replace("~~", "").replace("`", "")
    t = re.sub(r"^\s*(?:[-*+]\s*)?\[[ xXхХ✓✔]?\]\s*", "", t)  # «- [x] » / «[ ] »
    # numbering: «1.», «12)», «1 -», «№5», «#5 », but not «1984» nor «451 градус»
    t = re.sub(r"^\s*(?:№|#)?\s*\d{1,3}\s*(?:[.)\]:]|\s[-–—]\s)\s*", "", t)
    # leading symbols (bullets, dashes, emoji), keeping an opening quote or bracket
    i = 0
    while i < len(t) and (t[i].isspace() or (t[i] not in _KEEP_LEAD and unicodedata.category(t[i])[0] in "PSZC" and t[i] != "#")):
        i += 1
    t = t[i:]
    # trailing emoji and symbols, keeping a closing quote or bracket
    j = len(t)
    while j > 0 and (t[j - 1].isspace() or unicodedata.category(t[j - 1]) in ("So", "Sk", "Cf", "Mn") or t[j - 1] in "!?✓✔"):
        j -= 1
    return t[:j].strip()


def _drop_tail(line: str, k: _Known | None = None) -> str:
    """Ratings, dates and a lowercase aside in brackets at the end: «Дюна — 5/5», «Дюна (2024)», «Дюна (перечитывала)»."""
    t = line

    def cut(rx: re.Pattern, text: str) -> str:
        m = rx.search(text)
        if m is None:
            return text
        # what would go is a book the library knows («Оруэлл (1984)»): it stays
        if k is not None and k.work(m.group(0).strip(" ()[],;:—–-|")) is not None:
            return text
        return text[: m.start()].strip()

    for _ in range(4):
        before = t
        t = cut(_RATING, t)
        t = cut(_DATE, t)
        # a lowercase aside in brackets that is no volume: a note to oneself
        m = re.search(r"\s*\(([^()]*)\)\s*$", t)
        if m and m.group(1).strip() and m.group(1).strip()[0].islower() and not _is_volume(m.group(1)):
            t = t[: m.start()].strip()
        if t == before:
            break
    return t.strip(" \t.,;:·|—–-")


def _is_heading(line: str) -> bool:
    t = line.strip().rstrip(":").strip().casefold()
    if not t or line.strip().endswith(":"):
        return True
    if t in _HEADINGS or _MONTH_LINE.fullmatch(t):
        return True
    # «2025», «2025 год»: a year standing alone heads the books under it («1984» is a book)
    return bool(re.fullmatch(r"20[0-4]\d\s*(?:г\.?|год|жыл)?", t))


def _lines(text: str, k: _Known | None = None) -> list[str]:
    raw = re.split(r"[\n\r ]+", text[:MAX_TEXT])
    out: list[str] = []
    for part in raw:
        # «1. Дюна 2. 1984 3. Шантарам» on one line
        if len(re.findall(r"(?:^|\s)\d{1,3}[.)]\s+\S", part)) >= 2:
            pieces = re.split(r"(?:^|\s)(?=\d{1,3}[.)]\s+\S)", part)
        else:
            pieces = re.split(r"\s*;\s*", part)
        for piece in pieces:
            line = _strip_marks(piece).strip("\t ")
            if not line or _is_heading(line):
                continue
            line = _drop_tail(line, k)
            # prose around the list (a greeting, a sentence): too long for a title, or a sentence that ends so
            if len(line.split()) > 12 or re.search(r"[!?]\s*$", piece.strip()) and len(line.split()) > 1 and not re.search(r"[«\"]", line):
                if k is None or k.work(line) is None:
                    continue
            # what is left has to have a word or be a number of three digits and more («1984», «2666»)
            if not line or not (re.search(r"[^\W\d_]{2,}", line) or re.fullmatch(r"\d{3,5}", line)):
                continue
            # spaces collapse; a tab stays, it parts a spreadsheet's columns
            out.append(re.sub(r"[ \u00a0]+", " ", line)[:300])
    return out


# ---------- title or author ----------


@dataclass
class _Known:
    idx: catalog.CatalogIndex
    surnames: set[str] = field(default_factory=set)

    def work(self, title: str | None) -> catalog.Work | None:
        if not title or not title.strip():
            return None
        return book_face.work_of(self.idx, title=title.strip())

    def series_author(self, base: str) -> str | None:
        """«Гарри Поттер» of «Гарри Поттер 2»: the author of the library's books whose titles begin with it, when they
        are one person."""
        b = base.strip().casefold()
        if len(b.split()) < 2 and len(b) < 6:
            return None
        authors = {
            w.author for w in self.idx.works.values()
            if w.author and (w.title.casefold() == b or w.title.casefold().startswith(b + " "))
        }
        return authors.pop() if len(authors) == 1 else None

    def author_like(self, text: str) -> bool:
        """«Булгаков», «М. Булгаков», «Михаил Афанасьевич Булгаков», «Дж. Роулинг»: words of a name, one the
        library knows as someone who wrote a book, or a name with initials."""
        t = text.strip().strip(",.")
        if not t or len(t) > 70 or re.search(r"\d", t) or _is_volume(t):
            return False
        words = re.findall(r"[^\W\d_][\w'’-]*\.?", t)
        if not 1 <= len(words) <= 5 or not all(w[0].isupper() for w in words):
            return False
        if any(re.fullmatch(r"[^\W\d_]{1,3}\.", w) for w in words) and len(words) >= 2:
            return True
        return any(w.rstrip(".").casefold() in self.surnames for w in words)


def _name_shaped(text: str) -> bool:
    """Words that could be a name: one to four, each capitalized («Тайдгер», «Иван Петров»). Weaker than author_like:
    «Затерянный Мир» is shaped so too."""
    t = text.strip().strip(",")
    words = t.split()
    return 1 <= len(words) <= 4 and not re.search(r"\d", t) and all(w[:1].isupper() for w in words)


def _known(db: Session) -> _Known:
    idx = catalog.index(db)
    surnames: set[str] = set()
    for w in idx.works.values():
        if w.author:
            for word in re.findall(r"[^\W\d_]{4,}", w.author):
                surnames.add(word.casefold())
    return _Known(idx=idx, surnames=surnames)


def _side(text: str) -> str:
    """A side of a split, its separators off; a full stop kept after an initial («Булгаков М.»), and a year off a name
    («Фрэнк Герберт, 1965»)."""
    t = re.sub(r"[,\s]*\(?(?:19|20)\d{2}\)?\s*$", "", text.strip()) if re.search(r"[^\W\d_]{3,}", text) else text
    t = t.strip(" ,;:—–-")
    if t.endswith(".") and not re.search(r"(?:^|[\s.])[^\W\d_]{1,3}\.$", t):
        t = t.rstrip(".")
    return t.strip()


def _pair(k: _Known, a: str, b: str, *, confirm: bool) -> tuple[str, str | None] | None:
    """One side the title, the other the author. `confirm`: only when the library knows one side (a comma or a full
    stop is as often part of a title as a separator)."""
    a, b = _side(a), _side(b)
    if not a or not b:
        return None
    if _is_volume(b):
        return None
    if _is_volume(a):
        return None
    wa, wb = k.work(a), k.work(b)
    la, lb = k.author_like(a), k.author_like(b)
    digits_a, digits_b = bool(re.search(r"\d", a)), bool(re.search(r"\d", b))
    # a side with digits is no author: pages, a note («Дюна (600 стр.)»); a lowercase one is a note too
    # («— понравилось очень»)
    if wa is not None and wb is None:
        return (a, b) if lb or not (digits_b or b[0].islower()) else (a, None)
    if wb is not None and wa is None:
        return (b, a) if la or not (digits_a or a[0].islower()) else (b, None)
    if digits_b and not digits_a:
        return a, None
    if digits_a and not digits_b:
        return None
    if lb and not la:
        return a, b
    if la and not lb:
        return b, a
    if confirm:
        return None
    if b[0].islower():
        return a, None
    # neither known: the side shaped like a name, when only one is («Тайдгер — Неизвестная книга»)
    sa, sb = _name_shaped(a), _name_shaped(b)
    if sa and not sb:
        return b, a
    return a, b


def _split(k: _Known, line: str) -> tuple[str, str | None]:
    """The title and the author in a line."""
    line = _unbracket_volume(line)
    whole = k.work(line)
    if whole is not None and not re.search(r"\s[-–—]\s|\t|\(|«|\"| by ", line):
        return line, None

    # a spreadsheet's columns: title, then author
    cells = [c.strip() for c in line.split("\t") if c.strip()]
    if len(cells) >= 2:
        got = _pair(k, cells[0], cells[1], confirm=False)
        return got if got else (cells[0], None)

    # «Шантарам» Робертс / Булгаков «Мастер и Маргарита»
    quoted = re.search(r"[«\"“„]([^»\"”“]{2,})[»\"”“]", line)
    if quoted:
        title = quoted.group(1).strip()
        rest = (line[: quoted.start()] + " " + line[quoted.end():]).strip(" ,.;:—–-")
        if rest and _is_volume(rest):
            return f"{title}. {rest[0].upper()}{rest[1:]}", None
        return title, rest or None

    # «Title (Author)»
    m = re.match(r"^(.+?)\s*\(([^()]+)\)\s*$", line)
    if m:
        got = _pair(k, m.group(1), m.group(2), confirm=False)
        if got:
            return got

    # «Название — Автор» / «Автор — Название», «Title by Author»
    for sep in (r"\s+[-–—]+\s+", r"\s*[–—]\s*", r"\s+by\s+", r"\s*\|\s*"):
        halves = re.split(sep, line, maxsplit=1)
        if len(halves) == 2 and all(h.strip() for h in halves):
            got = _pair(k, halves[0], halves[1], confirm=False)
            if got:
                return got

    if whole is not None:
        return line, None

    # «1984 Оруэлл», «Оруэлл 1984», «Дюна Фрэнк Герберт»: a book the library knows next to a name it knows
    words = line.split(" ")
    for cut in range(1, min(4, len(words))):
        head, tail = " ".join(words[:-cut]), " ".join(words[-cut:])
        if k.author_like(tail) and k.work(head) is not None:
            return head, tail
        head, tail = " ".join(words[:cut]), " ".join(words[cut:])
        if k.author_like(head) and k.work(tail) is not None:
            return tail, head

    # «Булгаков. Мастер и Маргарита», «Ремарк, Три товарища», «Мастер и Маргарита, Булгаков»: only when the library
    # says which side is which
    for sep in (r"\.\s+", r",\s+", r":\s+"):
        for m in re.finditer(sep, line):
            got = _pair(k, line[: m.start()], line[m.end():], confirm=True)
            if got:
                return got
    return line, None


def _full_name(typed: str | None, known: str | None) -> str | None:
    """«Оруэлл» or «Дж. Оруэлл» typed for a book by «Джордж Оруэлл»: the library's name, the same person. Another name
    typed stays (a translator, a co-author, the reader's own word)."""
    if not typed:
        return known
    if not known:
        return typed
    words = {w.casefold() for w in re.findall(r"[^\W\d_]{3,}", known)}
    typed_words = [w.casefold() for w in re.findall(r"[^\W\d_]{3,}", typed)]
    return known if typed_words and all(w in words for w in typed_words) else typed


def _tidy_case(title: str) -> str:
    """«ДЮНА» and «дюна» typed are «Дюна» — for a book the library does not know (it spells the ones it knows)."""
    letters = [c for c in title if c.isalpha()]
    if letters and (all(c.isupper() for c in letters) and len(letters) > 3 or all(c.islower() for c in letters)):
        t = title.lower()
        return t[:1].upper() + t[1:]
    return title


# ---------- the plan ----------


@dataclass
class Item:
    n: int
    line: str
    title: str
    author: str | None
    # "add": not on the shelf, will go on it | "have": already there | "dup": the same book earlier in the list
    status: str
    # the shared library knows it: the title and the author are the library's
    known: bool
    # a copy the reader took off the shelf («Убрать с полки»): adding it puts that copy back
    hidden_key: str | None = None
    idents: set[str] = field(default_factory=set)


def _idents(k: _Known, title: str, work_key: str | None = None) -> set[str]:
    """What makes two copies one book here: the title's own key and the library's book, each with its volume (a
    library book may hold every volume of a series under one name)."""
    base, vol = volume(title)
    v = vol or 1
    out = set()
    key = catalog.work_key(base) or (normalize_book_title(base) or base.casefold())
    out.add(f"t:{key}#{v}")
    work = k.idx.find(work_key) if work_key else k.work(title)
    if work is not None:
        out.add(f"w:{work.key}#{v}")
    return out


def _item(k: _Known, n: int, line: str, title: str, author: str | None) -> Item:
    title = title.strip(" ,.;:—–-")[:300]
    author = (author or "").strip(" ,;:—–-")[:200] or None
    _, vol = volume(title)
    work = k.work(title)
    if work is not None:
        spelled = book_face.spelling(k.idx, title) or title
        # the library's spelling, unless it is another volume of the series
        if volume(spelled)[1] == vol:
            title = spelled
        author = _full_name(author, work.author)
    else:
        title = _tidy_case(title)
        base, _ = volume(title)
        series = k.work(base) if vol else None
        if vol and series is None:
            author = author or k.series_author(base)
        if series is not None:
            # another volume of a series the library knows: its author, and the series' spelling
            author = _full_name(author, series.author) or k.series_author(base)
            spelled = book_face.spelling(k.idx, base) or base
            title = title.replace(base, spelled, 1) if base in title else title
    return Item(n=n, line=line, title=title, author=author, status="add", known=work is not None, idents=_idents(k, title))


def _typed_in_days(db: Session, user_id: uuid.UUID) -> dict[str, list[str]]:
    """The titles as written in the reader's finished days, by the shelf copy they make. The shelf shows «Перси Джексон
    (часть 3)» of a circle's day as «Перси Джексон» (titles are compared without brackets): the volume is only here."""
    from app.models.round import ReadingLog
    from app.repositories.claims import ClaimsRepository
    from app.services.bookcase import _short_hash

    ids = list(ClaimsRepository(db).effective_user_ids(user_id=user_id))
    out: dict[str, list[str]] = {}
    for comment in db.execute(
        select(ReadingLog.comment).where(
            ReadingLog.user_id.in_(ids), ReadingLog.book_finished.is_(True), ReadingLog.comment.is_not(None),
        )
    ).scalars():
        title = comment.strip().splitlines()[0] if comment and comment.strip() else ""
        if title:
            out.setdefault(f"r:{_short_hash(normalize_book_title(comment))}", []).append(_unbracket_volume(title))
    return out


def _shelf(db: Session, user_id: uuid.UUID, k: _Known) -> tuple[set[str], dict[str, str]]:
    from app.services.bookcase import BookcaseService

    have: set[str] = set()
    hidden: dict[str, str] = {}
    typed = _typed_in_days(db, user_id)
    for b in BookcaseService(db).bookcase(owner_id=user_id, viewer_id=user_id).books:
        idents: set[str] = set()
        written = [t for t in typed.get(b.key, []) if volume(t)[1]]
        if written:
            # the volumes the days named: this copy is those, not «the book» without a number
            for t in written:
                idents |= _idents(k, t)
        else:
            for t in [b.title, *(b.read_as or [])]:
                if t:
                    idents |= _idents(k, t, b.work_key if t == b.title else None)
        if b.hidden:
            for i in idents:
                hidden.setdefault(i, b.key)
        else:
            have |= idents
    return have, hidden


def _settle(items: list[Item], have: set[str], hidden: dict[str, str]) -> list[Item]:
    seen: set[str] = set()
    for item in items:
        if item.idents & seen:
            item.status = "dup"
        elif item.idents & have:
            item.status = "have"
        else:
            item.status = "add"
            item.hidden_key = next((hidden[i] for i in sorted(item.idents) if i in hidden), None)
        seen |= item.idents
    return items


def plan(db: Session, user_id: uuid.UUID, text: str) -> list[Item]:
    """The list as read: each line's book and what would happen to it."""
    k = _known(db)
    items = []
    for n, line in enumerate(_lines(text, k)[:MAX_BOOKS]):
        title, author = _split(k, line)
        items.append(_item(k, n, line, title, author))
    have, hidden = _shelf(db, user_id, k)
    return _settle(items, have, hidden)


def apply(db: Session, user_id: uuid.UUID, books: list[tuple[str, str | None]]) -> tuple[list[Item], int]:
    """Puts these books on the shelf — the ones the reader kept ticked in the preview, as they left them (a title or
    an author they corrected included) — but for those already there. They are read now, so they leave «Хочу
    прочитать». Returns the books as settled and how many went on the shelf."""
    from app.models.book_review import BookReview
    from app.services import shelf_overrides, want

    k = _known(db)
    items = [
        _item(k, n, title, _unbracket_volume(title), author)
        for n, (title, author) in enumerate(books[:MAX_BOOKS])
        if title and title.strip()
    ]
    have, hidden = _shelf(db, user_id, k)
    _settle(items, have, hidden)
    existing = {b.title_norm for b in db.execute(select(ManualBook).where(ManualBook.user_id == user_id)).scalars()}
    added: list[tuple[Item, str]] = []
    for item in items:
        if item.status != "add":
            continue
        if item.hidden_key:
            shelf_overrides.set_hidden(db, user_id, item.hidden_key, False)
            added.append((item, item.hidden_key))
            continue
        norm = (normalize_book_title(item.title) or item.title.casefold())[:300]
        if norm in existing:
            continue
        existing.add(norm)
        book = ManualBook(user_id=user_id, title=item.title, title_norm=norm, author=item.author)
        db.add(book)
        db.flush()
        added.append((item, f"m:{book.id}"))
    if not added:
        return items, 0

    # read now: off the list of books to read (the same volume only)
    idents = set().union(*(i.idents for i, _ in added))
    for row in db.execute(select(WantBook).where(WantBook.user_id == user_id)).scalars():
        if _idents(k, row.title, row.work_key) & idents:
            db.delete(row)
    db.commit()

    # a mark given before a book was taken off the shelf comes back with it (only readers who have marks pay for it)
    if db.execute(select(BookReview.id).where(BookReview.user_id == user_id).limit(1)).first() is not None:
        for item, key in added:
            want.reattach_mark(db, user_id, item.title, key)
    return items, len(added)
