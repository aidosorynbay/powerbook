"""«Следить за книгой»: a reader hears when a book they wait for goes on the
bazaar or is finished in the circle, and the one who finished it hears
that readers want it. Private entries never tell anyone anything."""
from __future__ import annotations

from datetime import date, datetime

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
from app.models.enums import Gender, RoundParticipantStatus, RoundStatus
from app.models.group import Group
from app.models.manual_book import ManualBook
from app.models.notification import Notification
from app.models.round import Round, RoundParticipant
from app.models.user import User
from app.services import catalog
from app.services import reading as reading_service
from app.services.reading import ReadingService


class _Sept15(datetime):
    """Mid-September 2026, so the round's dates never depend on the day the tests run."""

    @classmethod
    def now(cls, tz=None):
        return datetime(2026, 9, 15, 12, 0, tzinfo=tz)


@pytest.fixture()
def env(monkeypatch):
    catalog.invalidate()
    monkeypatch.setattr(reading_service, "datetime", _Sept15)
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    db = Session()

    def user(name):
        u = User(username=name, display_name=name.title(), password_hash="x", gender=Gender.female)
        db.add(u)
        db.flush()
        return u

    dana, erlan, aigerim = user("dana"), user("erlan"), user("aigerim")
    group = Group(name="PowerBook", slug="powerbook", owner_user_id=dana.id)
    db.add(group)
    db.flush()
    rnd = Round(group_id=group.id, year=2026, month=9, status=RoundStatus.locked, end_day=None, registration_open_until_day=10)
    db.add(rnd)
    db.flush()
    db.add(RoundParticipant(round_id=rnd.id, user_id=aigerim.id, status=RoundParticipantStatus.active))
    # The book exists in the shared library through someone's shelf.
    db.add(ManualBook(user_id=erlan.id, title="Шантарам", title_norm="шантарам", author="Грегори Робертс"))
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

    def h(u):
        return {"Authorization": f"Bearer {create_access_token(subject=str(u.id))}"}

    yield type("Env", (), dict(db=db, client=client, h=h, dana=dana, erlan=erlan, aigerim=aigerim, round=rnd, Session=Session))
    catalog.invalidate()


def _kinds(env, user):
    return [n["kind"] for n in env.client.get("/api/notifications", headers=env.h(user)).json()]


def test_watching_a_book_and_hearing_it_is_on_the_bazaar(env):
    c = env.client
    r = c.put("/api/books/watch/shantaram", headers=env.h(env.dana))
    assert r.status_code == 200 and r.json() == {"watching": True, "watchers": 1}
    work = c.get("/api/books/work/shantaram", headers=env.h(env.dana)).json()
    assert work["watching"] is True and work["watchers"] == 1
    assert [w["title"] for w in c.get("/api/books/watches", headers=env.h(env.dana)).json()] == ["Шантарам"]

    listing = c.post("/api/market", json={"title": "Шантарам", "price": 3000, "condition": "good", "contact": "+7 777 123 45 67"}, headers=env.h(env.erlan))
    assert listing.status_code == 201, listing.text

    notes = c.get("/api/notifications", headers=env.h(env.dana)).json()
    assert [n["kind"] for n in notes] == ["watch_listing"]
    assert notes[0]["data"]["title"] == "Шантарам" and notes[0]["data"]["price"] == 3000
    assert _kinds(env, env.erlan) == []  # the seller is not told about their own listing

    assert c.get("/api/notifications/unread-count", headers=env.h(env.dana)).json() == {"count": 1}
    c.post("/api/notifications/read", json={}, headers=env.h(env.dana))
    assert c.get("/api/notifications/unread-count", headers=env.h(env.dana)).json() == {"count": 0}

    assert c.delete("/api/books/watch/shantaram", headers=env.h(env.dana)).json()["watching"] is False


def test_a_finish_in_the_circle_tells_the_watcher_and_the_finisher(env):
    env.client.put("/api/books/watch/shantaram", headers=env.h(env.dana))
    s = env.Session()
    try:
        svc = ReadingService(s)
        svc.log_minutes(round_id=env.round.id, user_id=env.aigerim.id, day=date(2026, 9, 14), minutes=60,
                        book_finished=True, comment="Шантарам", comment_private=False)
        # Saved again (minutes corrected): nobody hears twice.
        svc.log_minutes(round_id=env.round.id, user_id=env.aigerim.id, day=date(2026, 9, 14), minutes=70,
                        book_finished=True, comment="Шантарам", comment_private=False)
    finally:
        s.close()

    dana = env.client.get("/api/notifications", headers=env.h(env.dana)).json()
    assert [n["kind"] for n in dana] == ["watch_finished"] and dana[0]["data"]["reader"] == "Aigerim"
    mine = env.client.get("/api/notifications", headers=env.h(env.aigerim)).json()
    assert [n["kind"] for n in mine] == ["wanted_by"]
    assert mine[0]["data"]["n"] == 1 and mine[0]["data"]["volume_key"].startswith("r:")

    # Her shelf says the same beside «Продать».
    catalog.invalidate()
    shelf = env.client.get("/api/library/bookcase", headers=env.h(env.aigerim)).json()["books"]
    assert [b["wanted_by"] for b in shelf if b["title"] == "Шантарам"] == [1]


def test_a_private_finish_tells_no_one(env):
    env.client.put("/api/books/watch/shantaram", headers=env.h(env.dana))
    s = env.Session()
    try:
        ReadingService(s).log_minutes(round_id=env.round.id, user_id=env.aigerim.id, day=date(2026, 9, 13), minutes=40,
                                      book_finished=True, comment="Шантарам", comment_private=True)
    finally:
        s.close()
    assert env.db.query(Notification).count() == 0


def test_a_review_is_news_for_every_reader_who_wants_it(env):
    c = env.client
    ghost = User(username="old_nick", display_name="Old", password_hash="x", gender=Gender.female, is_claimable=True)
    env.db.add(ghost)
    env.db.commit()
    book = env.db.query(ManualBook).filter_by(user_id=env.erlan.id).one()
    vol = f"m:{book.id}"

    # Dana would rather not hear about reviews.
    assert c.get("/api/notifications/settings", headers=env.h(env.dana)).json() == {
        "new_review": True, "watch_listing": True, "watch_finished": True, "wanted_by": True,
    }
    r = c.put("/api/notifications/settings", json={"settings": {"new_review": False}}, headers=env.h(env.dana))
    assert r.status_code == 200 and r.json()["new_review"] is False and r.json()["watch_listing"] is True
    assert c.put("/api/notifications/settings", json={"settings": {"spam": True}}, headers=env.h(env.dana)).status_code == 422

    # A mark with no words is not a review.
    assert c.put("/api/books/reviews", json={"volume_key": vol, "rating": 8}, headers=env.h(env.erlan)).status_code == 200
    assert env.db.query(Notification).count() == 0

    long = "Очень сильная книга про Бомбей, дружбу и выбор. " * 6
    assert c.put("/api/books/reviews", json={"volume_key": vol, "rating": 9, "text": long}, headers=env.h(env.erlan)).status_code == 200
    notes = c.get("/api/notifications", headers=env.h(env.aigerim)).json()
    assert [n["kind"] for n in notes] == ["new_review"]
    d = notes[0]["data"]
    assert (d["title"], d["rating"], d["reader"], d["gender"]) == ("Шантарам", 9, "Erlan", "female")
    assert d["work_key"] and d["review_id"]
    assert d["quote"].startswith("Очень сильная книга") and d["quote"].endswith("…") and len(d["quote"]) <= 141
    # Not the one who wrote it, not whoever switched reviews off, not an archive name.
    assert _kinds(env, env.erlan) == [] and _kinds(env, env.dana) == []
    assert env.db.query(Notification).filter_by(user_id=ghost.id).count() == 0

    # Fixing a word or the mark says nothing new.
    c.put("/api/books/reviews", json={"volume_key": vol, "rating": 10, "text": "Перечитаю."}, headers=env.h(env.erlan))
    assert _kinds(env, env.aigerim) == ["new_review"]

    # The review gone, so is the news of it.
    assert c.delete(f"/api/books/reviews/{d['review_id']}", headers=env.h(env.erlan)).status_code == 204
    assert _kinds(env, env.aigerim) == []


def test_a_kind_switched_off_stays_quiet(env):
    c = env.client
    c.put("/api/books/watch/shantaram", headers=env.h(env.dana))
    c.put("/api/notifications/settings", json={"settings": {"watch_listing": False}}, headers=env.h(env.dana))
    listing = c.post("/api/market", json={"title": "Шантарам", "price": 3000, "condition": "good", "contact": "+7 777 123 45 67"}, headers=env.h(env.erlan))
    assert listing.status_code == 201, listing.text
    assert _kinds(env, env.dana) == []

    # Words taken out of a review take the news back too.
    book = env.db.query(ManualBook).filter_by(user_id=env.erlan.id).one()
    c.put("/api/notifications/settings", json={"settings": {"watch_listing": True}}, headers=env.h(env.dana))
    c.put("/api/books/reviews", json={"volume_key": f"m:{book.id}", "rating": 9, "text": "Сильно"}, headers=env.h(env.erlan))
    assert _kinds(env, env.dana) == ["new_review"]
    c.put("/api/books/reviews", json={"volume_key": f"m:{book.id}", "rating": 9, "text": " "}, headers=env.h(env.erlan))
    assert _kinds(env, env.dana) == []
