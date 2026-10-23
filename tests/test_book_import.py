"""«Вставить список»: the founder (2026-10-23) — a reader pastes the books they have read as text, and the ones missing
from their shelf go on it. Nothing is written before the reader has seen the list as it was read."""
from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.core.security import create_access_token
from app.db.base import Base
from app.db.session import get_db
from app.main import create_app
from app.models.enums import Gender, RoundStatus
from app.models.group import Group
from app.models.manual_book import ManualBook
from app.models.round import ReadingLog, Round
from app.models.user import User
from app.models.want_book import WantBook
from app.repositories.insights import normalize_book_title
from app.services import book_import, catalog

# The shared library: books other readers put on their shelves, with who wrote them.
LIBRARY = [
    ("Мастер и Маргарита", "Михаил Булгаков"), ("Три товарища", "Эрих Мария Ремарк"), ("1984", "Джордж Оруэлл"),
    ("Маленький принц", "Антуан де Сент-Экзюпери"), ("Цветы для Элджернона", "Дэниел Киз"),
    ("Перси Джексон и похититель молний", "Рик Риордан"), ("Страна сказок", "Крис Колфер"), ("Дюна", "Фрэнк Герберт"),
    ("Шантарам", "Грегори Дэвид Робертс"), ("Вторая жизнь Уве", "Фредрик Бакман"),
    ("Самый богатый человек в Вавилоне", "Джордж Сэмюэль Клейсон"), ("Гарри Поттер и философский камень", "Джоан Роулинг"),
    ("Война и мир", "Лев Толстой"), ("Абай жолы", "Мұхтар Әуезов"), ("451 градус по Фаренгейту", "Рэй Брэдбери"),
    ("Атомные привычки", "Джеймс Клир"), ("Sapiens", "Yuval Noah Harari"),
]


@pytest.fixture()
def env():
    catalog.invalidate()
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    db = Session()
    me = User(username="aigerim", display_name="Aigerim", password_hash="x", gender=Gender.female)
    dana = User(username="dana", display_name="Dana", password_hash="x", gender=Gender.female)
    db.add_all([me, dana])
    db.flush()
    for title, author in LIBRARY:
        db.add(ManualBook(user_id=dana.id, title=title, title_norm=normalize_book_title(title), author=author))
    group = Group(name="PowerBook", slug="powerbook", owner_user_id=dana.id)
    db.add(group)
    db.flush()
    rnd = Round(group_id=group.id, year=2026, month=9, status=RoundStatus.locked, end_day=None)
    db.add(rnd)
    db.flush()
    # On my shelf from the circle: «Дюна», the first «Страна сказок», and the third Percy Jackson written with brackets.
    for d, comment in [(4, "Дюна"), (5, "Страна сказок"), (6, "Перси Джексон (часть 3)")]:
        db.add(ReadingLog(round_id=rnd.id, user_id=me.id, date=date(2026, 9, d), minutes=40, score=1,
                          comment=comment, book_finished=True))
    db.commit()
    app = create_app()

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _db
    client = TestClient(app)
    h = {"Authorization": f"Bearer {create_access_token(subject=str(me.id))}"}
    yield type("Env", (), dict(db=db, client=client, h=h, me=me))
    catalog.invalidate()


def _preview(env, text):
    r = env.client.post("/api/library/read/import", json={"text": text}, headers=env.h)
    assert r.status_code == 200, r.text
    return r.json()["items"]


def _apply(env, items):
    books = [{"title": i["title"], "author": i["author"]} for i in items]
    r = env.client.post("/api/library/read/import", json={"books": books}, headers=env.h)
    assert r.status_code == 200, r.text
    return r.json()


def _shelf(env):
    return [b for b in env.client.get("/api/library/bookcase", headers=env.h).json()["books"] if not b["hidden"]]


# ---------- how a line is read ----------

# (as typed, the title, the author) — the author is the library's full name when it knows the person
LINES = [
    # the founder's own list (2026-10-23)
    ("1984", "1984", "Джордж Оруэлл"),
    ("Маленький Принц", "Маленький принц", "Антуан де Сент-Экзюпери"),
    ("Вторая Жизнь Уве", "Вторая жизнь Уве", "Фредрик Бакман"),
    ("Жизнь без Границ", "Жизнь без Границ", None),
    # the title and the author, either way round
    ("Мастер и Маргарита — Булгаков", "Мастер и Маргарита", "Михаил Булгаков"),
    ("Ремарк — Три товарища", "Три товарища", "Эрих Мария Ремарк"),
    ("Булгаков М. — Мастер и Маргарита", "Мастер и Маргарита", "Михаил Булгаков"),
    ("Булгаков. Мастер и Маргарита", "Мастер и Маргарита", "Михаил Булгаков"),
    ("Ремарк, Три товарища", "Три товарища", "Эрих Мария Ремарк"),
    ("Три товарища, Ремарк", "Три товарища", "Эрих Мария Ремарк"),
    ("Маленький принц (Экзюпери)", "Маленький принц", "Антуан де Сент-Экзюпери"),
    ("Мастер и Маргарита (М. Булгаков)", "Мастер и Маргарита", "Михаил Булгаков"),
    ("«Шантарам» Робертс", "Шантарам", "Грегори Дэвид Робертс"),
    ('Джордж Оруэлл "1984"', "1984", "Джордж Оруэлл"),
    ("Оруэлл — 1984", "1984", "Джордж Оруэлл"),
    ("Оруэлл (1984)", "1984", "Джордж Оруэлл"),
    ("1984 Оруэлл", "1984", "Джордж Оруэлл"),
    ("Sapiens by Yuval Noah Harari", "Sapiens", "Yuval Noah Harari"),
    ("Дюна\tФрэнк Герберт", "Дюна", "Фрэнк Герберт"),
    ("Тайдгер — Неизвестная книга", "Неизвестная книга", "Тайдгер"),
    ("Неизвестная книга — Иван Петров", "Неизвестная книга", "Иван Петров"),
    # numbering, bullets, marks and notes around the words
    ("1. Мастер и Маргарита", "Мастер и Маргарита", "Михаил Булгаков"),
    ("12) Шантарам", "Шантарам", "Грегори Дэвид Робертс"),
    ("3 - Шантарам", "Шантарам", "Грегори Дэвид Робертс"),
    ("• Шантарам", "Шантарам", "Грегори Дэвид Робертс"),
    ("- [x] Шантарам", "Шантарам", "Грегори Дэвид Робертс"),
    ("✅ Атомные привычки 👍", "Атомные привычки", "Джеймс Клир"),
    ("📚 Sapiens", "Sapiens", "Yuval Noah Harari"),
    ("**Дюна** — Фрэнк Герберт", "Дюна", "Фрэнк Герберт"),
    ("«Шантарам» Робертс ★★★★★", "Шантарам", "Грегори Дэвид Робертс"),
    ("Война и мир — 10/10", "Война и мир", "Лев Толстой"),
    ("Война и мир - 5 из 5", "Война и мир", "Лев Толстой"),
    ("Война и мир (перечитывала)", "Война и мир", "Лев Толстой"),
    ("Мастер и Маргарита - понравилось очень", "Мастер и Маргарита", "Михаил Булгаков"),
    ("Абай жолы (2024)", "Абай жолы", "Мұхтар Әуезов"),
    ("Дюна — 12.03.2024", "Дюна", "Фрэнк Герберт"),
    ("Дюна, март 2024", "Дюна", "Фрэнк Герберт"),
    ("Дюна (600 стр.)", "Дюна", "Фрэнк Герберт"),
    ("Дюна (Фрэнк Герберт, 1965)", "Дюна", "Фрэнк Герберт"),
    ("ДЮНА", "Дюна", "Фрэнк Герберт"),
    ("ночевала тучка золотая", "Ночевала тучка золотая", None),
    # a number is part of the title
    ("451 градус по Фаренгейту", "451 градус по Фаренгейту", "Рэй Брэдбери"),
    ("Метро 2033", "Метро 2033", None),
    ("Уловка-22", "Уловка-22", None),
    # volumes: their own books, the series' author
    ("Перси Джексон (часть 4)", "Перси Джексон. Часть 4", "Рик Риордан"),
    ("Перси Джексон (3)", "Перси Джексон 3", "Рик Риордан"),
    ("Страна Сказок 2", "Страна сказок 2", "Крис Колфер"),
    ("Гарри Поттер, книга 3", "Гарри Поттер, книга 3", "Джоан Роулинг"),
    ("Гарри Поттер (книга шестая)", "Гарри Поттер. Книга шестая", "Джоан Роулинг"),
    ("Война и мир II", "Война и мир II", "Лев Толстой"),
]


@pytest.mark.parametrize("line,title,author", LINES)
def test_a_line_is_read_whichever_way_it_was_written(env, line, title, author):
    items = _preview(env, line)
    assert [(i["title"], i["author"]) for i in items] == [(title, author)]


def test_headings_prose_and_marks_are_no_books(env):
    text = """Прочитано в 2025:
2025
Январь
Октябрь 2025
Мои книги
Всем привет! Вот что я прочитала за этот год, делюсь с вами своим списком книг:
Всем привет!
Очень советую всем прочитать эти книги, они изменили мою жизнь и взгляд на многие вещи вокруг нас
5/5
★★★
—
Шантарам
"""
    assert [i["title"] for i in _preview(env, text)] == ["Шантарам"]


def test_several_books_on_one_line(env):
    assert [i["title"] for i in _preview(env, "1. Мастер и Маргарита 2. 1984 3. Шантарам")] == [
        "Мастер и Маргарита", "1984", "Шантарам",
    ]
    assert [i["title"] for i in _preview(env, "Мастер и Маргарита; Шантарам; 1984")] == [
        "Мастер и Маргарита", "Шантарам", "1984",
    ]


def test_volumes_are_told_apart():
    assert book_import.volume("Перси Джексон. Часть 3") == ("Перси Джексон", 3)
    assert book_import.volume("Перси Джексон (часть 4)") == ("Перси Джексон", 4)
    assert book_import.volume("Гарри Поттер 7 часть") == ("Гарри Поттер", 7)
    assert book_import.volume("Перси Джексон 2-я книга") == ("Перси Джексон", 2)
    assert book_import.volume("Абай жолы 1-бөлім") == ("Абай жолы", 1)
    assert book_import.volume("Гарри Поттер #5") == ("Гарри Поттер", 5)
    assert book_import.volume("Гарри Поттер. Том 4") == ("Гарри Поттер", 4)
    assert book_import.volume("Book of Dust, Vol. 2") == ("Book of Dust", 2)
    assert book_import.volume("Война и мир II") == ("Война и мир", 2)
    assert book_import.volume("Гарри Поттер-1") == ("Гарри Поттер", 1)
    # numbers that are the title
    for title in ("1984", "Метро 2033", "Уловка-22", "451 градус по Фаренгейту", "Тайна 2666 года"):
        assert book_import.volume(title)[1] is None, title


# ---------- what the list does to the shelf ----------

FOUNDERS_LIST = """Цветы для Элджернона
Жизнь без Границ
1984
Маленький Принц
Ночевала тучка золотая
Монах, который продал Феррари
Перси Джексон (часть 3)
Перси Джексон (часть 4)
Страна Сказок 2
Затерянный Мир
Самый Богатый Человек в Вавилоне
Вторая Жизнь Уве
Пятнадцатилетний Капитан
Дюна
"""


def test_the_founders_list_every_line_and_every_volume(env):
    """The founder (2026-10-23): «1984» was missing, and «Перси Джексон (часть 4)» was taken for a second «часть 3»."""
    items = _preview(env, FOUNDERS_LIST)
    got = {i["title"]: i["status"] for i in items}
    assert len(items) == 14
    assert got["1984"] == "add"
    # the third Percy Jackson is on my shelf (written with brackets in the circle); the fourth is not
    assert got["Перси Джексон. Часть 3"] == "have"
    assert got["Перси Джексон. Часть 4"] == "add"
    # the first «Страна сказок» is on my shelf, the second is another book
    assert got["Страна сказок 2"] == "add"
    assert got["Дюна"] == "have"
    assert [i["status"] for i in items].count("add") == 12


def test_the_kept_books_go_on_the_shelf_as_the_reader_left_them(env):
    env.client.post("/api/library/want", json={"title": "Шантарам"}, headers=env.h)
    env.client.post("/api/library/want", json={"title": "Страна сказок"}, headers=env.h)
    items = _preview(env, "Мастер и Маргарита — Булгаков\nШантарам\nПерси Джексон (часть 4)\nДюна\nОпечатка в назвние")
    keep = [i for i in items if i["status"] == "add" and i["title"] != "Опечатка в назвние"]
    # a title the reader corrected in the preview goes in as corrected
    keep.append({"title": "Опечатка в названии", "author": "Иван Петров"})
    out = _apply(env, keep)
    assert out["added"] == 4
    shelf = {(b["title"], b["author"]) for b in _shelf(env)}
    assert {("Мастер и Маргарита", "Михаил Булгаков"), ("Шантарам", "Грегори Дэвид Робертс"),
            ("Перси Джексон. Часть 4", "Рик Риордан"), ("Опечатка в названии", "Иван Петров")} <= shelf
    assert not any(t == "Опечатка в назвние" for t, _ in shelf)
    # «Шантарам» is read now: off «Хочу прочитать»; «Страна сказок» (the first) stays wanted — no volume of it came
    assert [w.title for w in env.db.execute(select(WantBook)).scalars()] == ["Страна сказок"]

    # the same books again add nothing
    again = _apply(env, keep)
    assert again["added"] == 0 and {i["status"] for i in again["items"]} == {"have"}
    # and two volumes of a series both go on the shelf
    out = _apply(env, [{"title": "Перси Джексон. Часть 5", "author": None}, {"title": "Перси Джексон. Часть 6", "author": None}])
    assert out["added"] == 2


def test_a_book_taken_off_the_shelf_comes_back_rather_than_twice(env):
    c, h = env.client, env.h
    dune = next(b for b in _shelf(env) if b["title"] == "Дюна")
    assert c.put(f"/api/library/overrides/{dune['key']}/hidden", headers=h).status_code == 200

    items = _preview(env, "Дюна")
    assert [i["status"] for i in items] == ["add"]
    assert _apply(env, items)["added"] == 1
    books = [b for b in _shelf(env) if b["title"] == "Дюна"]
    assert [b["key"] for b in books] == [dune["key"]]
    assert env.db.execute(select(ManualBook).where(ManualBook.user_id == env.me.id)).scalars().all() == []


def test_nothing_to_read_is_refused(env):
    assert env.client.post("/api/library/read/import", json={}, headers=env.h).status_code == 422
    assert _preview(env, "\n\n—\n") == []
