"""When two books of the shared library are one (app/services/book_identity.py), on the real pairs the library held on
2026-10-23. The council's rule: only the same text written another way joins by itself; a likely double is the
founder's to answer, once; two volumes or two authors are never one book, whoever asks.

If a change to how titles are compared flips any case here, it is the change that is wrong."""
from __future__ import annotations

import pytest
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.admin_books import link
from app.core.booktitles import match_key
from app.db.base import Base
from app.models.book_link import BookLink
from app.models.book_pair import BookPair
from app.models.enums import Gender
from app.models.manual_book import ManualBook
from app.models.user import User
from app.repositories.insights import normalize_book_title
from app.services import admin_ping, book_identity, catalog

# the same text written another way: one book by itself
SAME_TEXT = [
    ("Адамзаттың асыл тәжі", "Адамзаттың асыл тəжі"),  # a Latin schwa for «ә»
    ("Алғашқы мұсылман Хазірет Хадиша", "Alğaşqy mūsylman haziret Hadişa"),  # Kazakh in Latin letters
    ("Тастамашы, ана!", "тастамашы ана"),
    ("«Кемел адам»", "Кемел адам"),
    ("Дюна (перечитывала)", "Дюна"),
]

# one book, but only the founder can say so: never joined by itself, never forbidden
FOUNDERS_WORD = [
    ("Монах, который продал Феррари", None, "Монах который продал свой Феррари", None),
    ("Кемел адам", "Қайрат Жолдыбайұлы", "Kemal adam", None),
    ("Өлгендер қайтып келмейді", "Б. Соқпақбаев", "Өлгендер қайтып келмеді", None),
    ("Материнское поде", None, "Материнское поле", "Чингиз Айтматов"),
    ("Ночь в Лиссабоне", None, "Ночь в Лиссабоне - Ремарк", None),
    ("Жизнь без границ", "Александр Вальков", "Жизнь без границ бітті", None),
    ("Как я создал Walmart", "Сэм Уолтон", "Как я создал Уол-Март", None),
    ("Властелин колец", "Джон Р. Р. Толкин", "Властелин колец", "Толкин"),
    ("Гарри Поттер и философский камень", "J. K. Rowling", "Гарри Поттер и философский камень", "Джоан Роулинг"),
]

# never one book: volumes of a series, and two authors
NEVER = [
    ("Сынық құмыра", "Сынық Құмыра 2"),
    ("Сынық Құмыра 2", "Сынық құмыра 5"),
    ("Шантарам", "Шантарам 1"),
    ("Шантарам 1", "Шантарам 2"),
    ("Абай жолы. I том", "Абай жолы. II том"),
    ("Қызыл Жебе.4-ші кітап", "Қызыл Жебе.5-ші кітап"),
    ("Қызыл Жебе 4", "Қызыл Жебе"),
    ("Граф Монте-Кристо", "Граф Монте-Кристо 2"),
    ("Бабалар сөзі 1", "Бабалар сөзі 2"),
    ("Хақ достары", "Хақ достары 2"),
    ("Унесенные ветром", "Унесенные ветром 1"),
    ("Жүрек төрінен орын алған теңдессіз тұлға 2", "Жүрек төрінен орын алған теңдессіз тұлға 3"),
    ("Перси Джексон (часть 3)", "Перси Джексон (часть 4)"),
]


@pytest.mark.parametrize("a,b", SAME_TEXT)
def test_the_same_text_written_another_way_is_one_book(a, b):
    assert match_key(a) == match_key(b)


@pytest.mark.parametrize("a,b", NEVER)
def test_two_volumes_are_never_one_book(a, b):
    assert book_identity.why_apart(a, None, b, None), (a, b)


@pytest.mark.parametrize("a,b", [p for p in NEVER if "(" in p[0]])
def test_a_volume_in_brackets_keeps_its_number_in_the_key(a, b):
    assert match_key(a) != match_key(b)


@pytest.mark.parametrize("ta,aa,tb,ab", FOUNDERS_WORD)
def test_a_likely_double_is_left_to_the_founder(ta, aa, tb, ab):
    # not joined by itself …
    assert match_key(ta) != match_key(tb) or ta == tb
    # … and nothing forbids it
    assert book_identity.why_apart(ta, aa, tb, ab) is None


def test_a_number_that_is_the_title_is_no_volume():
    for title in ("1984", "Метро 2033", "Уловка-22", "451 градус по Фаренгейту", "12 правил жизни"):
        assert book_identity.why_apart(title, None, title, None) is None, title
    assert book_identity.why_apart("Три товарища", "Ремарк", "Три товарища", "Эрих Мария Ремарк") is None


def test_two_authors_are_never_one_book():
    assert "авторы" in book_identity.why_apart("Мартин Иден", "Джек Лондон", "Мартин Иден", "Эрнест Хемингуэй")


# ---------- the founder's word ----------


@pytest.fixture()
def db():
    catalog.invalidate()
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, autoflush=False, autocommit=False)()
    readers = []
    for name in ("aigerim", "dana"):
        u = User(username=name, display_name=name.title(), password_hash="x", gender=Gender.female)
        session.add(u)
        readers.append(u)
    session.flush()
    for reader, title in [
        (readers[0], "Монах, который продал Феррари"), (readers[1], "Монах который продал свой Феррари"),
        (readers[0], "Шантарам 1"), (readers[1], "Шантарам 2"),
    ]:
        session.add(ManualBook(user_id=reader.id, title=title, title_norm=normalize_book_title(title)))
    session.commit()
    yield session
    session.close()
    catalog.invalidate()


def _work(db, title):
    return catalog.index(db).find(catalog.work_key(title))


def test_the_monk_goes_to_the_founder_and_volumes_do_not(db):
    pairs = [(a["title"], b["title"]) for a, b in book_identity.candidates(db)]
    assert any({"Монах, который продал Феррари", "Монах который продал свой Феррари"} == {a, b} for a, b in pairs)
    assert not any("Шантарам" in a for a, _ in pairs)


def test_the_founders_buttons(db, monkeypatch):
    sent = []
    monkeypatch.setattr(admin_ping, "chat_ids", lambda: ["1"])
    monkeypatch.setattr(admin_ping, "book_pair_waiting", lambda **kw: sent.append(kw))
    assert book_identity.ask_founder(db) == 1
    # asked once a day, not again by the other worker's tick
    assert book_identity.ask_founder(db) == 0
    pair = db.execute(select(BookPair)).scalar_one()
    assert pair.status == "asked" and sent[0]["pair_id"] == str(pair.id)

    assert book_identity.decide(db, pair.id, same=True).startswith("✅")
    catalog.invalidate()
    assert _work(db, "Монах, который продал Феррари").key == _work(db, "Монах который продал свой Феррари").key
    assert db.execute(select(BookLink)).scalar_one()
    # answered: never asked again, and a second press says so
    assert book_identity.candidates(db) == []
    assert book_identity.decide(db, pair.id, same=False).startswith("Уже решено")


def test_different_stays_different(db):
    a, b = _work(db, "Монах, который продал Феррари"), _work(db, "Монах который продал свой Феррари")
    assert book_identity.mark_apart(db, a.key, b.key)
    assert book_identity.candidates(db) == []
    assert db.execute(select(BookPair)).scalar_one().status == "apart"


def test_volumes_refuse_to_join_even_from_admin(db):
    one, two = _work(db, "Шантарам 1"), _work(db, "Шантарам 2")
    with pytest.raises(ValueError, match="разные тома"):
        link(db, [one.key, two.key], None)
    assert db.execute(select(BookLink)).first() is None


def test_the_buttons_reach_the_decision(db, monkeypatch):
    monkeypatch.setattr(admin_ping, "chat_ids", lambda: ["7"])
    calls = []
    monkeypatch.setattr(admin_ping, "_later", lambda method, payload: calls.append((method, payload)))
    a, b = _work(db, "Монах, который продал Феррари"), _work(db, "Монах который продал свой Феррари")
    ka, kb = sorted((a.key, b.key))
    pair = BookPair(key_a=ka, key_b=kb, title_a="a", title_b="b")
    db.add(pair)
    db.commit()
    admin_ping.on_update(db, {"callback_query": {"id": "q", "data": f"bp:d:{pair.id}", "from": {"id": 7}, "message": {}}})
    assert db.get(BookPair, pair.id).status == "apart"
    assert calls[0][0] == "answerCallbackQuery" and calls[0][1]["text"].startswith("❌")
    # someone else's press does nothing
    pair.status = "asked"
    db.commit()
    admin_ping.on_update(db, {"callback_query": {"id": "q", "data": f"bp:s:{pair.id}", "from": {"id": 8}, "message": {}}})
    assert db.get(BookPair, pair.id).status == "asked"


def test_the_founder_says_what_a_book_is_called(db):
    """2026-10-23: the Monk's card showed the spelling readers typed, without «свой»."""
    from app.admin_books import set_author

    a, b = _work(db, "Монах, который продал Феррари"), _work(db, "Монах который продал свой Феррари")
    link(db, [a.key, b.key], None)
    catalog.invalidate()
    work = _work(db, "Монах который продал свой Феррари")
    assert set_author(db, work.key, "Робин Шарма", None, title="Монах, который продал свой Феррари")
    idx = catalog.index(db)
    work = idx.find(catalog.work_key("Монах, который продал Феррари"))
    assert (work.title, work.author, work.title_fixed) == ("Монах, который продал свой Феррари", "Робин Шарма", True)
    # every copy's face is the founder's name, whichever way its reader typed it
    from app.services import book_face

    assert book_face.spelling(idx, "Монах, который продал Феррари") == "Монах, который продал свой Феррари"
    assert book_face.spelling(idx, "Монах который продал свой Феррари") == "Монах, который продал свой Феррари"
    # an author chosen later keeps the name (the forms that only pick an author send no title) …
    assert set_author(db, work.key, "Робин С. Шарма", None)
    assert catalog.index(db).find(work.key).title == "Монах, который продал свой Феррари"
    # … and an empty title gives it back to the readers
    assert set_author(db, work.key, "Робин Шарма", None, title="")
    assert not catalog.index(db).find(work.key).title_fixed
