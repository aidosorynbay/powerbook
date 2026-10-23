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
from app.services import book_import, catalog


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
    group = Group(name="PowerBook", slug="powerbook", owner_user_id=dana.id)
    db.add(group)
    db.flush()
    rnd = Round(group_id=group.id, year=2026, month=9, status=RoundStatus.locked, end_day=None)
    db.add(rnd)
    db.flush()
    # Dana finished «Гауһар тас» in the circle: a book of the shared library. I finished «Дюна».
    db.add(ReadingLog(round_id=rnd.id, user_id=dana.id, date=date(2026, 9, 3), minutes=40, score=1,
                      comment="Гауһар тас", book_finished=True))
    db.add(ReadingLog(round_id=rnd.id, user_id=me.id, date=date(2026, 9, 4), minutes=40, score=1,
                      comment="Дюна", book_finished=True))
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


LIST = """Прочитано в 2025:
1. Мастер и Маргарита — Булгаков
2) дюна
- Тайдгер Х. — Гауһар тас (2024)
• «Шантарам» Робертс ★★★★★
мастер и маргарита — Булгаков

5/5
"""


def test_the_lines_are_read_whatever_way_they_were_written():
    assert book_import._lines(LIST) == [
        "Мастер и Маргарита — Булгаков", "дюна", "Тайдгер Х. — Гауһар тас", "«Шантарам» Робертс", "мастер и маргарита — Булгаков",
    ]


def test_a_pasted_list_is_shown_before_anything_is_written(env):
    c, h = env.client, env.h
    out = c.post("/api/library/read/import", json={"text": LIST}, headers=h).json()
    got = [(i["title"], i["author"], i["status"], i["known"]) for i in out["items"]]
    assert got == [
        ("Мастер и Маргарита", "Булгаков", "add", False),
        # on my shelf from the circle
        ("Дюна", None, "have", True),
        # the library knows the book: the side it names is the title, whichever way round it was typed
        ("Гауһар тас", "Тайдгер Х.", "add", True),
        ("Шантарам", "Робертс", "add", False),
        ("мастер и маргарита", "Булгаков", "dup", False),
    ]
    assert out["added"] == 0
    assert env.db.execute(select(ManualBook)).scalars().all() == []


def test_an_author_in_brackets_stays_with_a_book_the_library_knows(env):
    out = env.client.post("/api/library/read/import", json={"text": "Гауһар тас (Тайдгер)"}, headers=env.h).json()
    assert [(i["title"], i["author"], i["known"]) for i in out["items"]] == [("Гауһар тас", "Тайдгер", True)]


def test_the_missing_books_go_on_the_shelf_but_the_unticked(env):
    c, h = env.client, env.h
    # wanted before: read now, it leaves «Хочу прочитать»
    c.post("/api/library/want", json={"title": "Шантарам"}, headers=h)
    preview = c.post("/api/library/read/import", json={"text": LIST}, headers=h).json()
    gauhar = next(i["n"] for i in preview["items"] if i["title"] == "Гауһар тас")

    out = c.post("/api/library/read/import", json={"text": LIST, "apply": True, "skip": [gauhar]}, headers=h).json()
    assert out["added"] == 2
    shelf = {b["title"] for b in c.get("/api/library/bookcase", headers=h).json()["books"] if not b["hidden"]}
    assert {"Мастер и Маргарита", "Шантарам", "Дюна"} <= shelf and "Гауһар тас" not in shelf
    assert env.db.execute(select(WantBook)).scalars().all() == []

    # the same list again adds nothing: everything is on the shelf
    again = c.post("/api/library/read/import", json={"text": LIST, "apply": True, "skip": [gauhar]}, headers=h).json()
    assert again["added"] == 0
    assert {i["status"] for i in again["items"] if i["n"] != gauhar} <= {"have", "dup"}


def test_a_book_taken_off_the_shelf_comes_back_rather_than_twice(env):
    c, h = env.client, env.h
    dune = next(b for b in c.get("/api/library/bookcase", headers=h).json()["books"] if b["title"] == "Дюна")
    assert c.put(f"/api/library/overrides/{dune['key']}/hidden", headers=h).status_code == 200

    out = c.post("/api/library/read/import", json={"text": "Дюна", "apply": True}, headers=h).json()
    assert out["added"] == 1
    books = [b for b in c.get("/api/library/bookcase", headers=h).json()["books"] if b["title"] == "Дюна"]
    assert [(b["key"], b["hidden"]) for b in books] == [(dune["key"], False)]
    assert env.db.execute(select(ManualBook)).scalars().all() == []
