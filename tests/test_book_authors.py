"""One book, one author: «Три товарища» showed Remarque on some shelves and
another name on others (2026-10-15). Names compared as people, the author
the sources agree on, the founder's word over all, and a cover lookup that
no longer takes a translator or another book of the same title for the
author."""
from __future__ import annotations

import urllib.error
import uuid
from datetime import date

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.admin_books import author_disputes, set_author
from app.core import authors
from app.db.base import Base
from app.models.book_author import BookAuthor
from app.models.book_cover import BookCover
from app.models.enums import Gender, RoundStatus
from app.models.group import Group
from app.models.round import ReadingLog, Round
from app.models.user import User
from app.repositories.insights import normalize_book_title
from app.services import catalog, covers, shelf_overrides
from app.services.bookcase import BookcaseService, _short_hash

REMARQUE = "Эрих Мария Ремарк"


# ---------- names as people ----------


@pytest.mark.parametrize(
    "a, b",
    [
        ("Ремарк", REMARQUE),
        (REMARQUE, "Erich Maria Remarque"),
        ("Ремарк Э. М.", REMARQUE),
        ("Э.М. Ремарк", "Ремарк Эрих Мария"),
        ("Fyodor Dostoevsky", "Фёдор Достоевский"),
        ("Дж. К. Роулинг", "Джоан Роулинг"),
        ("Хэл Элорд", "Хэл Элрод"),
        ("Сент-Экзюпери", "Антуан де Сент-Экзюпери"),
    ],
)
def test_one_person_spelled_two_ways(a, b):
    assert authors.same_person(a, b) and authors.same_person(b, a)


@pytest.mark.parametrize(
    "a, b",
    [
        ("Ирина Шрайбер", REMARQUE),
        ("Михаил Булгаков", "Михаил Зощенко"),
        ("Лев Толстой", "Алексей Толстой"),
        ("", REMARQUE),
    ],
)
def test_two_people(a, b):
    assert not authors.same_person(a, b)


def test_what_reads_as_an_author_after_a_title():
    for name in ("Ремарк", REMARQUE, "Э. М. Ремарк", "Э.М. Ремарк", "J. K. Rowling", "Антуан де Сент-Экзюпери"):
        assert authors.looks_like_name(name), name
    for words in ("перечитала", "очень понравилось", "9/10", "Шедевр!", "", "1984"):
        assert not authors.looks_like_name(words), words
    assert authors.looks_like_name("ремарк", capitals=False)


def test_the_person_most_sources_name_printed_in_full():
    found = authors.people([("Ирина Шрайбер", 1), ("Ремарк", 1.5), ("Erich Maria Remarque", 1), (REMARQUE, 1)])
    assert len(found) == 2
    assert found[0].written("cyr") == REMARQUE and found[0].written("lat") == "Erich Maria Remarque"
    assert found[1].names == ["Ирина Шрайбер"]


def test_a_tie_goes_to_the_better_known_author():
    known = authors.Directory([REMARQUE, REMARQUE, "Эрих Мария Ремарк", "Сергей Михалков"])
    found = authors.people([("Сергей Михалков", 1), (REMARQUE, 1)], prominence=known.prominence)
    assert found[0].written() == REMARQUE


# ---------- the shared library and the shelves ----------


@pytest.fixture()
def env():
    catalog.invalidate()
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False, autocommit=False)()

    def user(name):
        u = User(username=name, display_name=name.title(), password_hash="x", gender=Gender.female)
        db.add(u)
        db.flush()
        return u

    aidos, dana, erlan, aigerim = user("aidos"), user("dana"), user("erlan"), user("aigerim")
    group = Group(name="PowerBook", slug="powerbook", owner_user_id=aidos.id)
    db.add(group)
    db.flush()
    rnd = Round(group_id=group.id, year=2026, month=9, status=RoundStatus.locked, end_day=None)
    db.add(rnd)
    db.flush()

    def finished(u, day, comment):
        db.add(ReadingLog(round_id=rnd.id, user_id=u.id, date=date(2026, 9, day), minutes=40, score=0,
                          comment=comment, book_finished=True))

    def cover(title, author, edition=None):
        db.add(BookCover(key=covers.cover_key(title), query=title, status="found", author=author,
                         source="google", source_id=edition or f"G-{title}", image=None))

    # Dana wrote whose it is; Erlan and Aigerim only the title, each their own way.
    finished(dana, 3, "«Три товарища» Ремарк\nПлакала в конце")
    finished(erlan, 5, "Три товарища")
    finished(aigerim, 7, "три товарища!!")
    # Remarque's other book, so the library knows the full name.
    finished(aidos, 9, "На западном фронте без перемен")
    # The lookup for «Три товарища» took the translator of the pictured edition for the author.
    cover("Три товарища", "Ирина Шрайбер", "G-shreiber")
    cover("На западном фронте без перемен", REMARQUE)
    db.commit()

    def shelf(u):
        return {b.title: b for b in BookcaseService(db).bookcase(owner_id=u.id, viewer_id=u.id).books}

    yield type("Env", (), dict(db=db, aidos=aidos, dana=dana, erlan=erlan, aigerim=aigerim, finished=finished,
                               cover=cover, shelf=shelf))
    db.close()
    catalog.invalidate()


def _work(db, title):
    idx = catalog.index(db)
    return idx.find(catalog.work_key(title))


def test_one_author_on_every_shelf(env):
    work = _work(env.db, "Три товарища")
    # A reader's «Ремарк» is a real author the library knows, and outweighs one lookup.
    assert work.author == REMARQUE
    assert [name for name, _ in work.author_rivals] == [REMARQUE, "Ирина Шрайбер"]
    for reader in (env.dana, env.erlan, env.aigerim):
        assert env.shelf(reader)["Три товарища"].author == REMARQUE, reader.username


def test_a_reader_typed_author_stays_theirs(env):
    vol = f"r:{_short_hash(normalize_book_title('Три товарища'))}"
    shelf_overrides.set_text(env.db, env.erlan.id, vol, None, "Э. М. Ремарк (пер. И. Шрайбер)")
    assert env.shelf(env.erlan)["Три товарища"].author == "Э. М. Ремарк (пер. И. Шрайбер)"
    assert env.shelf(env.aigerim)["Три товарища"].author == REMARQUE


def test_a_comment_after_the_title_that_is_no_name_is_not_an_author(env):
    env.finished(env.erlan, 11, "«Мастер и Маргарита» Перечитала")
    env.finished(env.dana, 12, "«Мастер и Маргарита» очень понравилось")
    env.cover("Мастер и Маргарита", "Михаил Булгаков")
    env.db.commit()
    catalog.invalidate()
    assert _work(env.db, "Мастер и Маргарита").author == "Михаил Булгаков"
    assert env.shelf(env.erlan)["Мастер и Маргарита"].author == "Михаил Булгаков"


def test_many_spellings_of_one_lookup_are_one_opinion(env):
    # Five more readers spelled it like the wrong lookup; a lookup is still one voice against Dana's word.
    for i in range(5):
        u = User(username=f"r{i}", display_name=f"R{i}", password_hash="x", gender=Gender.female)
        env.db.add(u)
        env.db.flush()
        env.finished(u, 13 + i, "Три товарища")
    env.db.commit()
    catalog.invalidate()
    assert _work(env.db, "Три товарища").author == REMARQUE


def test_the_founder_names_the_author(env):
    work = _work(env.db, "Три товарища")
    env.db.execute(BookCover.__table__.update().values(author_checked_at=None))
    assert set_author(env.db, work.key, "  Эрих   Мария Ремарк ", None)
    work = _work(env.db, "Три товарища")
    assert work.author == REMARQUE and work.author_fixed and work.author_rivals[0][0] == REMARQUE
    assert env.db.query(BookAuthor).one().title == work.title
    assert author_disputes(catalog.index(env.db), {}) == []
    # Even against every source.
    assert set_author(env.db, work.key, "Сергей Михалков", None)
    assert env.shelf(env.dana)["Три товарища"].author == "Сергей Михалков"
    assert env.db.query(BookAuthor).count() == 1
    # An empty name gives it back to the sources.
    assert set_author(env.db, work.key, "", None)
    assert _work(env.db, "Три товарища").author == REMARQUE
    assert env.db.query(BookAuthor).count() == 0


def test_disputed_books_are_listed_for_the_founder(env):
    rows = author_disputes(catalog.index(env.db), {})
    assert [r["title"] for r in rows] == ["Три товарища"]
    assert rows[0]["author"] == REMARQUE and rows[0]["rivals"][0]["name"] == "Ирина Шрайбер"


# ---------- the cover lookup ----------


def _candidate(volume_id, creators, title="Три товарища", thumb=True):
    return covers._Candidate(volume_id=volume_id, titles=[title], creators=creators, has_thumbnail=thumb)


@pytest.fixture()
def editions(monkeypatch, tmp_path):
    """Google answers with these editions; every one has a picture."""
    found: list[covers._Candidate] = []
    monkeypatch.setattr(covers, "COVERS_DIR", tmp_path)
    monkeypatch.setattr(covers, "_search", lambda q: list(found))
    monkeypatch.setattr(covers, "_search_open_library", lambda q: [])
    monkeypatch.setattr(covers, "_search_flip", lambda q: [])
    monkeypatch.setattr(covers, "_search_chitai", lambda q: [])
    monkeypatch.setattr(covers, "_wikidata_cover", lambda q: None)
    monkeypatch.setattr(covers, "_fetch_images", lambda c, min_width=250: (b"full", b"small"))
    return found


def _look_up(query, hint=None):
    row = BookCover(key=covers.cover_key(query), query=query, status="working", attempts=0)
    covers._look_up(row, hint)
    return row


def test_the_author_most_editions_agree_on_not_the_first_pictured(editions):
    editions += [
        # A poem of the same title comes first in the results.
        _candidate("M1", ["Сергей Михалков"]),
        _candidate("R1", [REMARQUE]),
        _candidate("R2", ["Erich Maria Remarque", "Ирина Шрайбер"]),
        _candidate("R3", [REMARQUE, "Ирина Шрайбер"]),
    ]
    row = _look_up("Три товарища")
    assert row.status == "found" and row.author == REMARQUE
    assert row.source_id in {"R1", "R3"}


def test_the_readers_word_picks_the_other_book_when_an_edition_bears_it_out(editions):
    editions += [_candidate("M1", ["Сергей Михалков"]), _candidate("R1", [REMARQUE]), _candidate("R2", [REMARQUE])]
    row = _look_up("Три товарища", hint="Михалков")
    assert row.author == "Сергей Михалков" and row.source_id == "M1"


def test_a_translator_in_the_readers_script_is_not_the_author(editions):
    editions += [_candidate("R2", ["Erich Maria Remarque", "Ирина Шрайбер"])]
    # The only name in Cyrillic is the translator's: better no author than the translator.
    assert _look_up("Три товарища").author is None


# ---------- asking again ----------


def test_disputed_lookups_are_asked_again_once(env, monkeypatch, tmp_path):
    monkeypatch.setattr(covers, "COVERS_DIR", tmp_path)
    asked = []

    def look_up(row, hint):
        asked.append((row.query, hint))
        row.status, row.author, row.source, row.source_id, row.image = "found", REMARQUE, "google", "R1", "b" * 32

    monkeypatch.setattr(covers, "_look_up", look_up)
    assert covers.recheck_disputed(env.db) == 1
    assert asked == [("Три товарища", None)]
    row = env.db.get(BookCover, covers.cover_key("Три товарища"))
    assert row.author == REMARQUE and row.source_id == "R1" and row.image == "b" * 32
    assert row.author_checked_at is not None
    # The sources agree now: nothing left to ask.
    assert _work(env.db, "Три товарища").author_rivals == []
    assert covers.recheck_disputed(env.db) == 0


def test_the_founders_author_is_searched_with(env, monkeypatch):
    asked = []

    def look_up(row, hint):
        asked.append(hint)
        row.status, row.author = "found", hint

    monkeypatch.setattr(covers, "_look_up", look_up)
    set_author(env.db, _work(env.db, "Три товарища").key, REMARQUE, None)
    covers.recheck_disputed(env.db)
    assert asked == [REMARQUE]
    # Without a picture this time, the old one stays and only the author changes.
    row = env.db.get(BookCover, covers.cover_key("Три товарища"))
    assert row.author == REMARQUE and row.source_id == "G-shreiber"


def test_google_pushing_back_leaves_the_rest_for_later(env, monkeypatch):
    def look_up(row, hint):
        raise urllib.error.HTTPError("u", 429, "Too Many Requests", None, None)

    monkeypatch.setattr(covers, "_look_up", look_up)
    assert covers.recheck_disputed(env.db) == 0
    assert env.db.get(BookCover, covers.cover_key("Три товарища")).author_checked_at is None


def test_unknown_key_is_refused(env):
    assert set_author(env.db, "no-such-book-" + uuid.uuid4().hex, "Кто-то", None) is False


def test_an_author_typed_by_hand_counts_in_any_case(env):
    from app.models.manual_book import ManualBook

    env.db.add(ManualBook(user_id=env.erlan.id, title="Тихий Дон", title_norm="тихий дон", author="михаил шолохов"))
    env.db.commit()
    catalog.invalidate()
    assert _work(env.db, "Тихий Дон").author == "михаил шолохов"


def test_words_after_a_title_that_are_no_name_stay_off_the_spine(env):
    env.finished(env.erlan, 20, "«Неизвестная книга» очень понравилось")
    env.db.commit()
    catalog.invalidate()
    assert env.shelf(env.erlan)["Неизвестная книга"].author is None
