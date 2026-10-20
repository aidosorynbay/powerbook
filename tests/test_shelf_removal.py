"""A book taken off the shelf and added back (the founder, 2026-10-21): it can be added again as read or to read later,
a mark given before stays in the shared library but no longer makes its author a reader, comes back with the book and
never doubles, and the minutes given the book are never lost. No catalog.invalidate() here on purpose: the library
must follow the shelf by itself — the earlier tests called it and hid that it didn't."""
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
from app.models.book_review import BookReview
from app.models.enums import Gender, RoundStatus
from app.models.group import Group
from app.models.manual_book import ManualBook
from app.models.round import ReadingLog, ReadingLogBook, Round
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
    me = User(username="madik", display_name="Madik", password_hash="x", gender=Gender.male)
    dana = User(username="dana", display_name="Dana", password_hash="x", gender=Gender.female)
    db.add_all([me, dana])
    db.flush()
    group = Group(name="PowerBook", slug="powerbook", owner_user_id=dana.id)
    db.add(group)
    db.flush()
    rnd = Round(group_id=group.id, year=2026, month=9, status=RoundStatus.locked, end_day=None)
    db.add(rnd)
    db.flush()
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
    key = catalog.index(db).find(catalog.work_key("Гауһар тас")).key

    def card():
        return client.get(f"/api/books/work/{key}", headers=h).json()

    def count():
        return client.get("/api/insights/profile", headers=h).json()["books_finished"]

    def read():
        r = client.post("/api/library/read", json={"title": "Гауһар тас", "work_key": key}, headers=h)
        assert r.status_code == 200, r.text
        return r.json()["volume_key"]

    yield type("Env", (), dict(db=db, client=client, h=h, me=me, rnd=rnd, key=key, card=card, count=count, read=read))
    catalog.invalidate()


def _me_reader(card):
    return any(r["is_viewer"] for r in card["readers_list"])


def test_taken_off_and_added_back_at_once_as_read_or_to_read(env):
    vk = env.read()
    assert env.card()["my_volume_key"] == vk and _me_reader(env.card()) and env.count() == 1
    manual = env.db.query(ManualBook).one()
    assert env.client.delete(f"/api/insights/books/{manual.id}", headers=env.h).status_code == 204
    # the card follows at once: not mine, not a reader, the count down
    card = env.card()
    assert card["my_volume_key"] is None and not _me_reader(card) and env.count() == 0
    # to read later this time
    assert env.client.post("/api/library/want", json={"title": "Гауһар тас", "work_key": env.key}, headers=env.h).status_code == 200
    assert [w["title"] for w in env.client.get("/api/library/want", headers=env.h).json()] == ["Гауһар тас"]
    # then read: off the list, on the shelf
    env.read()
    assert env.client.get("/api/library/want", headers=env.h).json() == [] and env.count() == 1


def test_a_mark_stays_in_the_library_comes_back_with_the_book_and_never_doubles(env):
    vk = env.read()
    r = env.client.put("/api/books/reviews", json={"volume_key": vk, "rating": 9, "text": "Сильно"}, headers=env.h)
    assert r.status_code == 200, r.text
    manual = env.db.query(ManualBook).one()
    env.client.delete(f"/api/insights/books/{manual.id}", headers=env.h)

    card = env.card()
    assert card["my_volume_key"] is None and card["my_review"]["rating"] == 9
    assert [x["text"] for x in card["reviews"]] == ["Сильно"] and not _me_reader(card)

    new_vk = env.read()
    card = env.card()
    assert card["my_volume_key"] == new_vk and card["my_review"]["rating"] == 9 and _me_reader(card)
    env.db.expire_all()
    marks = env.db.query(BookReview).filter_by(user_id=env.me.id).all()
    assert len(marks) == 1 and marks[0].volume_key == new_vk
    # the shelf shows it on the copy again
    shelf = env.client.get("/api/library/bookcase", headers=env.h).json()["books"]
    assert next(b for b in shelf if b["key"] == new_vk)["rating"] == 9

    # and taken back from the card when the book is off the shelf
    env.client.delete(f"/api/insights/books/{env.db.query(ManualBook).one().id}", headers=env.h)
    review_id = env.card()["my_review"]["id"]
    assert env.client.delete(f"/api/books/reviews/{review_id}", headers=env.h).status_code == 204
    assert env.card()["my_review"] is None and env.card()["reviews"] == []


def test_a_book_finished_in_a_circle_and_taken_off_comes_back_with_its_day(env):
    env.db.add(ReadingLog(round_id=env.rnd.id, user_id=env.me.id, date=date(2026, 9, 10), minutes=50, score=1,
                          comment="Гауһар тас", book_finished=True))
    env.db.commit()
    shelf = env.client.get("/api/library/bookcase", headers=env.h).json()["books"]
    rk = next(b["key"] for b in shelf if b["key"].startswith("r:"))
    assert env.count() == 1
    env.client.put(f"/api/library/overrides/{rk}/hidden", headers=env.h)
    assert env.count() == 0 and env.card()["my_volume_key"] is None
    # back: the same circle copy, not a second one by hand
    assert env.read() == rk
    assert env.count() == 1 and env.db.query(ManualBook).count() == 0


def test_the_minutes_given_a_book_are_never_lost(env):
    log = ReadingLog(round_id=env.rnd.id, user_id=env.me.id, date=date.today(), minutes=45, score=1)
    env.db.add(log)
    env.db.flush()
    env.db.add(ReadingLogBook(reading_log_id=log.id, user_id=env.me.id, title="Гауһар тас", title_norm="гауһар тас", minutes=45))
    env.db.commit()
    assert env.card()["my_minutes"] == 45
    vk = env.read()
    shelf = env.client.get("/api/library/bookcase", headers=env.h).json()["books"]
    assert next(b for b in shelf if b["key"] == vk)["minutes_read"] == 45
    env.client.delete(f"/api/insights/books/{env.db.query(ManualBook).one().id}", headers=env.h)
    assert env.card()["my_minutes"] == 45
    vk = env.read()
    shelf = env.client.get("/api/library/bookcase", headers=env.h).json()["books"]
    assert next(b for b in shelf if b["key"] == vk)["minutes_read"] == 45
