"""The AI librarian's deep reading of a taste (app/services/taste.py) and each book's DNA (app/services/book_dna.py):
the founder (2026-10-22) — not one person's other ten, but what the books are like and what the reader is like."""
from __future__ import annotations

import json

from app.core.security import create_access_token
from app.models.book_dna import BookDna
from app.services import book_dna, catalog, librarian
from app.services.taste import Taste
from tests.test_librarian import _mark, env  # noqa: F401  (the fixture)

WARM = {"mood": ["warm", "melancholic"], "pace": "slow", "themes": ["friendship", "love"], "form": "novel", "era": "classic"}
COLD = {"mood": ["tense", "dark"], "pace": "fast", "themes": ["mystery", "power"], "form": "novel", "era": "contemporary"}


def _dna(env, title, traits):
    key = catalog.index(env.db).find(catalog.work_key(title)).key
    env.db.add(BookDna(key=key, title=title, status="done", traits=traits, essence=f"{title} in a line", attempts=1))
    env.db.commit()
    return key


def test_dna_keeps_only_the_words_of_its_vocabulary():
    got = book_dna.clean({
        "mood": ["Warm", "glorious", "warm", "dark", "tense", "funny"], "pace": "slow", "length": "huge",
        "themes": ["friendship", "dragons"], "form": "novel", "style": [], "era": "classic", "ease": "easy",
    })
    assert got == {"mood": ["warm", "dark", "tense"], "pace": "slow", "themes": ["friendship"], "form": "novel", "era": "classic", "ease": "easy"}
    assert book_dna.clean({"mood": [], "themes": ["nonsense"]}) is None
    vec = book_dna.vector({"themes": ["friendship", "love"], "pace": "slow"})
    assert vec["themes:friendship"] > vec["themes:love"] and vec["pace:slow"] < vec["themes:friendship"]


def test_the_ai_writes_the_dna_of_untagged_books_in_batches(env):
    fake = env.deepseek([json.dumps({"books": [
        {"id": "b1", "known": True, "mood": ["warm"], "pace": "slow", "length": "medium", "themes": ["friendship"],
         "form": "novel", "style": ["literary"], "era": "classic", "ease": "medium", "essence": "Three friends between the wars."},
        {"id": "b2", "known": False, "mood": [], "pace": "", "length": "", "themes": [], "form": "", "style": [], "era": "", "ease": "", "essence": ""},
    ]})])
    assert book_dna.tag(env.db, limit=2) == 1
    sent = json.loads(fake.requests[-1]["body"]["messages"][1]["content"])["books"]
    assert [b["id"] for b in sent] == ["b1", "b2"]
    rows = {r.status for r in env.db.query(BookDna).all()}
    assert rows == {"done", "unknown"}
    # the book it did not know is asked again (up to three tries), after the books never tried
    unknown = env.db.query(BookDna).filter_by(status="unknown").one()
    fake = env.deepseek([json.dumps({"books": []})])
    book_dna.tag(env.db, limit=50)
    asked_titles = [b["title"] for b in json.loads(fake.requests[-1]["body"]["messages"][1]["content"])["books"]]
    assert asked_titles[-1] == unknown.title
    # done books are not asked again
    fake = env.deepseek([json.dumps({"books": []})])
    book_dna.tag(env.db, limit=50)
    asked = {b["title"] for b in json.loads(fake.requests[-1]["body"]["messages"][1]["content"])["books"]}
    assert not asked & {r.title for r in env.db.query(BookDna).filter_by(status="done")}


def test_the_portrait_and_the_fit_come_from_what_the_books_are_like(env):
    env.deepseek([])
    _dna(env, "Три товарища", WARM)
    _dna(env, "Обломов", {**WARM, "themes": ["love", "society"]})
    _dna(env, "Маленький принц", COLD)
    _mark(env, "Три товарища", 10)
    _mark(env, "Обломов", 9)
    _mark(env, "Маленький принц", 3)
    warm = _dna(env, "Триумфальная арка", WARM)
    cold = _dna(env, "Шантарам", COLD)

    reader = librarian._Reader(env.db, env.me)
    taste = Taste(env.db, reader)
    assert taste.portrait["themes:friendship"] > 0.2 and taste.portrait["mood:tense"] < 0
    assert "themes:friendship" in taste.likes() and "mood:tense" in taste.dislikes()
    good, bad = taste.fit(warm), taste.fit(cold)
    assert good.match > 75 > 40 > bad.match
    # «love» is in both books loved, «friendship» in one: love leads
    assert good.fits[:2] == ["mood:warm", "themes:love"] and "mood:tense" in bad.clashes
    ranked = [f.key for f in taste.rank([cold, warm], 2)]
    assert ranked[0] == warm

    # the page says the taste, and each pick its match
    fake = env.deepseek([json.dumps({"taste": "t", "picks": [{"id": "b1", "why": "w"}], "outside": []})])
    env.client.post("/api/reading/picks", json={"lang": "ru", "force": True}, headers=env.h)
    body = json.loads(fake.requests[-1]["body"]["messages"][1]["content"])
    first = body["candidates"][0]
    assert first["title"] == "Триумфальная арка" and first["match_percent"] > 75 and "about love" in first["fits_their_taste"]
    # trait codes reach the AI as plain words
    assert "about friendship" in body["reader"]["portrait"]["likes"]
    got = env.client.get("/api/reading/picks?lang=ru", headers=env.h).json()
    assert got["picks"][0]["match"] > 75 and got["picks"][0]["fits"] and "themes:love" in got["likes"]


def test_a_kindred_reader_is_one_who_agrees_on_many_books_not_one_ten(env):
    dh = {"Authorization": f"Bearer {create_access_token(subject=str(env.dana.id))}"}
    env.deepseek([])
    # Dana and I: the same marks on three books — kindred
    for title, mine, hers in (("Три товарища", 9, 9), ("Обломов", 4, 3), ("Маленький принц", 8, 9)):
        _mark(env, title, mine)
        catalog.invalidate()
    # Dana marks the books she read; she has all three of mine? only «Три товарища» is hers — so give her the others
    from datetime import date

    from app.models.round import ReadingLog, Round

    rnd = env.db.query(Round).one()
    for i, title in enumerate(("Обломов", "Маленький принц")):
        env.db.add(ReadingLog(round_id=rnd.id, user_id=env.dana.id, date=date(2026, 9, 20 + i), minutes=30, score=1, comment=title, book_finished=True))
    env.db.commit()
    for title, rating in (("Три товарища", 9), ("Обломов", 3), ("Маленький принц", 9), ("Стоунер", 10)):
        assert _mark(env, title, rating, headers=dh).status_code == 200
    catalog.invalidate()
    reader = librarian._Reader(env.db, env.me)
    taste = Taste(env.db, reader)
    dana = catalog.index(env.db).person_of(env.dana.id)
    assert taste.kin.get(dana, 0) > 0.5 and taste.kin_agree[dana] == (3, 3)
    stoner = catalog.index(env.db).find(catalog.work_key("Стоунер")).key
    fans = taste.kindred_fans(stoner, reader.names)
    assert fans == [{"name": "Dana", "gender": "female", "mark": 10, "agrees_with_reader": "3 of 3 books both marked"}]


def test_a_why_with_an_english_trait_code_is_dropped_in_russian():
    assert librarian._speaks_codes("та же melancholic-ткань", "ru") is True
    assert librarian._speaks_codes("Как «Stoner» Уильямса", "ru") is False
    assert librarian._speaks_codes("a melancholic novel", "en") is False
    assert librarian._speaks_codes("Как «The Power of Habit», только о вере", "ru") is False
    assert librarian._said("themes:coming_of_age") == "about coming of age"


def test_the_note_lists_everything_the_picks_stand_on(env):
    env.deepseek([])
    _dna(env, "Три товарища", WARM)
    _mark(env, "Три товарища", 10, "про дружбу")
    _mark(env, "Обломов", 6)
    env.client.post("/api/library/want", json={"title": "Стоунер"}, headers=env.h)
    got = env.client.get("/api/reading/picks?lang=ru", headers=env.h).json()["basis"]
    assert got["marks"] == [{"title": "Три товарища", "mark": 10}, {"title": "Обломов", "mark": 6}]
    assert got["reviews_with_words"] == 1 and got["wanted"] == ["Стоунер"]
    assert "Маленький принц" in got["finished"] and "Три товарища" not in got["finished"]
    assert got["dna_known"] == 1 and got["dna_total"] >= 12
