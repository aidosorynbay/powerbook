"""What a book is about, in a handful of words everyone shares.

Catalogues describe books each in their own vocabulary: Google says
"Self-Help / Personal Growth / Success", Open Library lists forty subjects,
Wikidata names a genre. The reading summaries need one small list to count
by — "this year you read mostly psychology and classics" — so every source's
words are folded onto the keys below. The labels live in the frontend's
i18n (topics.<key>); Claude is given the keys and chooses among them.
"""
from __future__ import annotations

import re

TOPICS: tuple[str, ...] = (
    "classics",
    "modern_prose",
    "fantasy_scifi",
    "detective",
    "romance",
    "self_help",
    "psychology",
    "business",
    "history",
    "science",
    "philosophy",
    "religion",
    "biography",
    "kazakh",
    "poetry",
    "young",
    "health",
    "education",
)

# Checked in order; a book takes every topic whose words it carries, the
# strongest first. Words are matched at the start of a word, in lower case.
_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("self_help", ("self-help", "self help", "personal growth", "success", "motivation", "productivity",
                   "habits", "саморазвит", "мотивац", "продуктивн", "привычк", "успех", "личностн", "тайм-менедж",
                   "time management", "өзін-өзі дамыт")),
    ("psychology", ("psycholog", "психолог", "emotion", "эмоци", "mind", "cognitive", "когнитив", "therapy",
                    "терапи", "relationships", "отношени", "neuroscience", "нейро")),
    ("business", ("business", "econom", "finance", "invest", "money", "management", "leadership", "marketing",
                  "entrepreneur", "бизнес", "экономик", "финанс", "инвест", "деньг", "менеджмент", "лидерств",
                  "маркетинг", "предприним", "қаржы", "кәсіп")),
    ("philosophy", ("philosoph", "философ", "stoic", "стоиц", "ethics", "этика", "existential", "экзистенц")),
    ("religion", ("religion", "relig", "islam", "christian", "quran", "koran", "bible", "spiritual", "theolog",
                  "религ", "ислам", "христиан", "коран", "библи", "духовн", "богослов", "дін", "құран",
                  "пайғамбар", "мұсылман", "намаз", "сира")),
    ("biography", ("biograph", "autobiograph", "memoir", "биограф", "автобиограф", "мемуар", "воспоминани",
                   "өмірбаян", "естелік")),
    ("history", ("history", "historical", "war", "истори", "войн", "тарих", "соғыс")),
    ("science", ("science", "physics", "biology", "astronom", "mathemat", "chemistry", "evolution", "technology",
                 "computer", "научн", "наука", "физик", "биолог", "астроном", "математ", "хими", "эволюц",
                 "технолог", "ғылым")),
    ("health", ("health", "medicine", "medical", "nutrition", "diet", "fitness", "sleep", "sport",
                "здоров", "медицин", "питани", "диет", "фитнес", "сон", "спорт", "денсаулық")),
    ("education", ("education", "language", "study", "learning", "teaching", "parenting", "образован",
                   "язык", "обучени", "учеб", "воспитани", "педагог", "білім", "тәрбие")),
    ("young", ("juvenile", "children", "young adult", "teen", "fairy tale", "детск", "подрост", "сказк",
               "балалар", "ертегі")),
    ("poetry", ("poetry", "poems", "verse", "поэзи", "стих", "поэм", "өлең", "жыр")),
    ("fantasy_scifi", ("fantasy", "science fiction", "sci-fi", "dystopia", "utopia", "фэнтези", "фантаст",
                       "антиутоп", "утопи", "қиял")),
    ("detective", ("detective", "mystery", "thriller", "crime", "suspense", "детектив", "триллер",
                   "криминал", "мистик")),
    ("romance", ("romance", "love stor", "любовн", "роман о любви", "махаббат")),
    ("classics", ("classic", "классик", "русская литература", "russian literature", "literary classics",
                  "классика")),
    ("kazakh", ("kazakh", "казах", "қазақ", "kazakhstan", "казахстан")),
    ("modern_prose", ("fiction", "novel", "magic realism", "магический реализм", "художествен", "проза", "роман", "повесть", "рассказ", "литератур",
                      "әдебиет", "хикая")),
]

_KAZAKH_LETTERS = re.compile(r"[әғқңөұүһі]", re.IGNORECASE)


def from_subjects(subjects: list[str], *, title: str = "", year: int | None = None, limit: int = 3) -> list[str]:
    """Topic keys for a book, from the catalogues' words for it."""
    text = " | ".join(s.lower() for s in subjects if s)
    found: list[str] = []
    for key, words in _RULES:
        if any(re.search(r"(?<![a-zа-яёәғқңөұүһі])" + re.escape(w), text) for w in words):
            found.append(key)
    # Fiction written before the twentieth century is the classics, whatever
    # the catalogue filed it under.
    if year and year < 1930 and "modern_prose" in found:
        found.remove("modern_prose")
        found.insert(0, "classics")
    # Nothing else known, but written in Kazakh: that alone says something.
    if not found and _KAZAKH_LETTERS.search(title or ""):
        found.append("kazakh")
    # "Fiction" is the weakest word: keep it only when nothing sharper came up.
    if len(found) > 1 and "modern_prose" in found:
        found.remove("modern_prose")
    return list(dict.fromkeys(found))[:limit]


def clean(keys: list[str] | None) -> list[str]:
    """Only keys we know, in order, without repeats."""
    return [k for k in dict.fromkeys(keys or []) if k in TOPICS]
