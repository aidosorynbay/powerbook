"""«Хочу прочитать»: a second shelf of books to read later. The founder (2026-10-21): a book from the shared library
goes among the read ones or here, and a book wanted counts nowhere — not on the shelf, not in the count."""
from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.core.security import create_access_token
from app.db.base import Base
from app.db.session import get_db
from app.main import create_app
from app.models.enums import Gender, RoundStatus
from app.models.group import Group
from app.models.round import ReadingLog, Round
from app.models.user import User
from app.services import catalog


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
    # Dana read «Гауһар тас»: it is a book of the shared library.
    db.add(ReadingLog(round_id=rnd.id, user_id=dana.id, date=date(2026, 9, 3), minutes=40, score=1,
                      comment="Гауһар тас", book_finished=True))
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


def _work_key(env):
    return catalog.index(env.db).find(catalog.work_key("Гауһар тас")).key


def test_a_book_wanted_is_on_the_list_and_counts_nowhere(env):
    c, h = env.client, env.h
    key = _work_key(env)
    assert c.post("/api/library/want", json={"title": "Гауһар тас", "work_key": key}, headers=h).status_code == 200
    # twice is still once
    c.post("/api/library/want", json={"title": "гауһар тас", "work_key": key}, headers=h)
    wanted = c.get("/api/library/want", headers=h).json()
    assert [w["title"] for w in wanted] == ["Гауһар тас"] and wanted[0]["work_key"] == key

    # not on the read shelf, not a reader of the book, not in the profile's count
    catalog.invalidate()
    assert c.get("/api/library/bookcase", headers=h).json()["books"] == []
    work = c.get(f"/api/books/work/{key}", headers=h).json()
    assert work["my_volume_key"] is None and work["my_want_id"] == wanted[0]["id"]
    assert all(not r["is_viewer"] for r in work["readers_list"])

    # read it: it moves to the read shelf and leaves the list by itself
    assert c.post("/api/insights/books", json={"title": "Гауһар тас", "author": None, "finished_on": None}, headers=h).status_code == 201
    catalog.invalidate()
    assert c.get("/api/library/want", headers=h).json() == []


def test_a_book_taken_off_the_list_is_gone_and_others_cannot_take_it(env):
    c, h = env.client, env.h
    want_id = c.post("/api/library/want", json={"title": "Книга не из библиотеки", "author": "Кто-то"}, headers=h).json()["id"]
    wanted = c.get("/api/library/want", headers=h).json()
    assert wanted[0]["work_key"] is None and wanted[0]["author"] == "Кто-то"
    dana = env.db.query(User).filter_by(username="dana").one()
    other = {"Authorization": f"Bearer {create_access_token(subject=str(dana.id))}"}
    assert c.delete(f"/api/library/want/{want_id}", headers=other).status_code == 404
    assert c.delete(f"/api/library/want/{want_id}", headers=h).status_code == 200
    assert c.get("/api/library/want", headers=h).json() == []


def test_a_circle_title_with_an_aside_is_the_readers_book_on_its_card(env):
    """«Бегущий за ветром (The kite runner - ағылшыншасы мэйк мор сэнс)»: on the reader's shelf and theirs in the
    library too, so its card says so and «Прочитал(а)» has nothing left to do."""
    c, h = env.client, env.h
    rnd = env.db.query(Round).one()
    env.db.add(ReadingLog(round_id=rnd.id, user_id=env.me.id, date=date(2026, 9, 5), minutes=40, score=1,
                          comment="Бегущий за ветром (The kite runner - ағылшыншасы мэйк мор сэнс)", book_finished=True))
    env.db.commit()
    catalog.invalidate()
    work = catalog.index(env.db).find(catalog.work_key("Бегущий за ветром"))
    assert work is not None and env.me.id in work.holders
    assert c.get(f"/api/books/work/{work.key}", headers=h).json()["my_volume_key"] is not None
