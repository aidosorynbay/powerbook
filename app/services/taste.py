"""A reader's taste, read deeply, and how well each book of the library fits it — the ground of the AI librarian's
picks (app/services/librarian.py).

The founder (2026-10-22): «я думал ты глубокие анализы настроишь» — not one person's other ten. Three things:

1. The portrait. Every book the reader knows says something, each by its DNA (app/services/book_dna.py): a mark
   (10 loves, 6 shrugs, 3 dislikes), a book finished unmarked (a mild yes), one they gave far more minutes than usual
   (a stronger yes), one dropped half-way (a mild no), a favourite (a strong yes), «Хочу прочитать» (a yes),
   «Не моё» (a no). Summed per trait — «тёплые», «медленные», «о дружбе» — and shrunk toward nothing while there is
   little to go on, so one book never makes a taste.
2. Kindred readers, by all the marks they share with the reader — the low ones too — and the books they both finished:
   one who agrees on six books of seven counts, one shared ten does not.
3. Each book of the library: how well its DNA fits the portrait (a percent), what the kindred readers thought of it,
   and its quality; the best, kept varied (no author twice, no three alike), go to the AI to choose from and explain.
"""
from __future__ import annotations

import math
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.book_review import BookReview
from app.services import book_dna, book_time
from app.services import books as books_service

# What each kind of knowing a book says, from -1 (no) to +1 (yes).
FAVOURITE = 1.0
FINISHED = 0.35
LONG_READ = 0.15  # more minutes than the reader's usual book: on top of finishing it
WANTED = 0.3
DROPPED = -0.25
NOT_FOR_ME = -0.8
# A trait is a taste only after enough books say so: the portrait is shrunk by this much evidence.
SHRINK = 1.5
# How the three signals are mixed into a book's score.
W_FIT, W_KIN, W_QUALITY = 0.55, 0.25, 0.2
# A book with no DNA yet: as if it fitted this much (below an average good fit).
NO_DNA_FIT = 0.4


def mark_signal(rating: int) -> float:
    return (rating - 6) / 4


@dataclass
class Fit:
    key: str
    score: float
    # percent, 0..100, when the book has DNA and the reader a portrait
    match: int | None
    # the traits of the book the reader likes most / dislikes, strongest first
    fits: list[str] = field(default_factory=list)
    clashes: list[str] = field(default_factory=list)


class Taste:
    def __init__(self, db: Session, reader) -> None:
        """`reader` is librarian._Reader: what the reader marked, read, wants, turned down and named favourite."""
        self.reader = reader
        idx = reader.idx
        self.dna = {k: row for k, row in book_dna.of_works(db).items() if row.status == "done" and row.traits}
        self.vectors = {k: book_dna.vector(row.traits) for k, row in self.dna.items()}

        # what each book the reader knows says
        signals: dict[str, float] = {}
        for key, review in reader.marks:
            signals[key] = mark_signal(review.rating)
        times = book_time.of_readers(db, list(reader.accounts), idx)
        finished_minutes = sorted(bt.minutes for bt in times.values() if bt.finished and bt.minutes)
        usual = finished_minutes[len(finished_minutes) // 2] if finished_minutes else 0
        long_ago = date.today() - timedelta(days=60)
        for key in reader.read:
            if key not in signals:
                signals[key] = FINISHED
        for key, bt in times.items():
            if key in signals and usual and bt.finished and bt.minutes >= 1.5 * usual:
                signals[key] += LONG_READ
            if key not in signals and not bt.finished and bt.minutes >= 60 and bt.last_day and bt.last_day < long_ago:
                signals[key] = DROPPED
        for key in reader.favourite_keys:
            signals[key] = max(signals.get(key, 0.0), FAVOURITE)
        for key in reader.want_keys:
            signals.setdefault(key, WANTED)
        for key in reader.dismissed_keys:
            signals[key] = NOT_FOR_ME
        self.signals = signals

        # the portrait: per trait, the books' say weighed by how much of the trait they have
        said: dict[str, float] = defaultdict(float)
        weight: dict[str, float] = defaultdict(float)
        for key, s in signals.items():
            for trait, w in self.vectors.get(key, {}).items():
                said[trait] += s * w
                weight[trait] += abs(s) * w
        self.portrait = {t: said[t] / (weight[t] + SHRINK) for t in said}
        self.known_with_dna = sum(1 for k in signals if k in self.vectors)

        self._kin(db)
        self.marks_all = books_service._marks(db, idx)

    # ---------- kindred readers ----------

    def _kin(self, db: Session) -> None:
        idx = self.reader.idx
        rated: dict[uuid.UUID, dict[str, int]] = defaultdict(dict)
        for account, key, rating in db.execute(select(BookReview.user_id, BookReview.work_key, BookReview.rating)).all():
            work = idx.find(key)
            if work is not None:
                rated[idx.person_of(account)][work.key] = rating
        me = self.reader.people
        mine = {k: r.rating for k, r in self.reader.marks}
        my_read = self.reader.read
        self.kin: dict[uuid.UUID, float] = {}
        self.kin_agree: dict[uuid.UUID, tuple[int, int]] = {}
        for person, theirs in rated.items():
            if person in me:
                continue
            shared = [k for k in theirs if k in mine]
            sim = 0.0
            if len(shared) >= 2:
                gaps = [abs(theirs[k] - mine[k]) for k in shared]
                agree = 1 - sum(gaps) / (9 * len(gaps))
                sim += max(0.0, (agree - 0.7) / 0.3) * min(1.0, len(shared) / 4)
                self.kin_agree[person] = (sum(1 for g in gaps if g <= 2), len(shared))
            both = len(my_read & idx.by_person.get(person, set()))
            if both >= 3:
                union = len(my_read | idx.by_person.get(person, set())) or 1
                sim += 0.5 * both / union
            if sim > 0:
                self.kin[person] = sim
        self.rated = rated
        # each book: what the kindred readers say of it
        self.kin_say: dict[str, float] = defaultdict(float)
        for person, sim in self.kin.items():
            for key, rating in rated[person].items():
                self.kin_say[key] += sim * mark_signal(rating)
            for key in idx.by_person.get(person, set()):
                if key not in rated[person]:
                    self.kin_say[key] += sim * 0.2

    def kindred_fans(self, key: str, names: dict, limit: int = 2) -> list[dict]:
        """Kindred readers who marked this book 8+, the most kindred first: name, gender, mark, and how often they
        agree with the reader («6 of 7 books in common»)."""
        idx = self.reader.idx
        fans = []
        for person, sim in sorted(self.kin.items(), key=lambda kv: -kv[1]):
            rating = self.rated.get(person, {}).get(key)
            if rating is None or rating < 8:
                continue
            name, gender = names.get(idx.account_of(person), (None, None))
            if not name:
                continue
            entry = {"name": name, "gender": gender, "mark": rating}
            if person in self.kin_agree:
                agree, shared = self.kin_agree[person]
                entry["agrees_with_reader"] = f"{agree} of {shared} books both marked"
            fans.append(entry)
            if len(fans) == limit:
                break
        return fans

    # ---------- the portrait, said plainly ----------

    def likes(self, n: int = 5) -> list[str]:
        good = [t for t, p in sorted(self.portrait.items(), key=lambda kv: -kv[1]) if p > 0.2]
        return good[:n]

    def dislikes(self, n: int = 3) -> list[str]:
        bad = [t for t, p in sorted(self.portrait.items(), key=lambda kv: kv[1]) if p < -0.15]
        return bad[:n]

    # ---------- each book ----------

    def fit(self, key: str) -> Fit:
        vec = self.vectors.get(key)
        if not vec or not self.portrait:
            return Fit(key, 0.0, None)
        total = sum(vec.values())
        raw = sum(w * self.portrait.get(t, 0.0) for t, w in vec.items()) / total
        match = round(50 + 50 * math.tanh(raw * 2.5))
        fits = [t for t, _ in sorted(((t, w * self.portrait.get(t, 0)) for t, w in vec.items()), key=lambda x: -x[1]) if self.portrait.get(t, 0) > 0.15][:3]
        clashes = [t for t in vec if self.portrait.get(t, 0) < -0.15][:2]
        return Fit(key, raw, match, fits, clashes)

    def quality(self, key: str) -> float:
        work = self.reader.idx.works[key]
        q = math.log1p(len(work.readers)) / 3
        if key in self.marks_all:
            q += self.marks_all[key].weighted / 10
        fact = self.reader.facts.get(key)
        if fact is not None and fact.rating is not None:
            q += float(fact.rating) / float(fact.rating_scale or 5)
        return q

    def rank(self, keys: list[str], limit: int) -> list[Fit]:
        """The best of these books for the reader, varied: no author more than once, no three of one kind."""
        if not keys:
            return []
        fits = {k: self.fit(k) for k in keys}
        kin = {k: self.kin_say.get(k, 0.0) for k in keys}
        quality = {k: self.quality(k) for k in keys}

        def norm(values: dict[str, float]) -> dict[str, float]:
            if not values:
                return {}
            lo, hi = min(values.values()), max(values.values())
            return {k: (v - lo) / (hi - lo) if hi > lo else 0.5 for k, v in values.items()}

        has_portrait = self.known_with_dna >= 2 and bool(self.portrait)
        fit_n = norm({k: f.score for k, f in fits.items() if f.match is not None}) if has_portrait else {}
        kin_n, q_n = norm(kin), norm(quality)
        for k, f in fits.items():
            if has_portrait:
                f.score = W_FIT * fit_n.get(k, NO_DNA_FIT) + W_KIN * kin_n[k] + W_QUALITY * q_n[k]
            else:
                f.score = 0.55 * kin_n[k] + 0.45 * q_n[k]

        chosen: list[Fit] = []
        authors: dict[str, int] = defaultdict(int)
        pool = sorted(fits.values(), key=lambda f: -f.score)
        while pool and len(chosen) < limit:
            best, best_value = None, -1e9
            for f in pool[: limit * 4]:
                author = (self.reader.idx.works[f.key].author or "").casefold()
                if author and authors[author] >= 1:
                    continue
                vec = self.vectors.get(f.key, {})
                alike = max((_overlap(vec, self.vectors.get(c.key, {})) for c in chosen[-6:]), default=0.0)
                value = f.score - 0.12 * alike
                if value > best_value:
                    best, best_value = f, value
            if best is None:
                best = pool[0]
            pool.remove(best)
            chosen.append(best)
            author = (self.reader.idx.works[best.key].author or "").casefold()
            if author:
                authors[author] += 1
        return chosen


def _overlap(a: dict[str, float], b: dict[str, float]) -> float:
    if not a or not b:
        return 0.0
    shared = set(a) & set(b)
    return len(shared) / math.sqrt(len(a) * len(b))
