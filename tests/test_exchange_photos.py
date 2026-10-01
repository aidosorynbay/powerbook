"""The book exchange in pictures: a reader confirms the book in hand with a
photo, and the round's results page shows the photos for the circle."""
from __future__ import annotations

import base64

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
from app.models.exchange_photo import ExchangePhoto
from app.models.group import Group
from app.models.round import BookExchangePair, Round
from app.models.user import User

JPEG = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8\xff\xe0" + b"0" * 200 + b"\xff\xd9").decode()


@pytest.fixture()
def env():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    db = Session()
    giver = User(username="erlan", display_name="Ерлан", password_hash="x", gender=Gender.male, telegram_id="erlan_kz")
    receiver = User(username="aigerim", display_name="Айгерим", password_hash="x", gender=Gender.female)
    stranger = User(username="dana", display_name="Дана", password_hash="x", gender=Gender.female)
    db.add_all([giver, receiver, stranger])
    db.flush()
    group = Group(name="PowerBook", slug="powerbook", owner_user_id=giver.id)
    db.add(group)
    db.flush()
    september = Round(group_id=group.id, year=2026, month=9, status=RoundStatus.results_published, end_day=None, registration_open_until_day=10)
    db.add(september)
    db.flush()
    pair = BookExchangePair(round_id=september.id, giver_user_id=giver.id, receiver_user_id=receiver.id)
    db.add(pair)
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

    yield type("Env", (), dict(db=db, client=client, h=h, giver=giver, receiver=receiver, stranger=stranger,
                               round=september, pair=pair))


def test_a_photo_confirms_the_exchange_and_shows_on_the_results(env):
    c = env.client
    r = c.post(f"/api/exchange/{env.pair.id}/photo", json={"photo": JPEG, "caption": "  Спасибо!  "}, headers=env.h(env.receiver))
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["role"] == "receiver" and out["caption"] == "Спасибо!" and out["url"].startswith("/exchange/photos/")

    env.db.expire_all()
    assert env.db.get(BookExchangePair, env.pair.id).receiver_marked_received_at is not None

    res = c.get(f"/api/rounds/{env.round.id}/results", headers=env.h(env.receiver)).json()
    assert [p["giver_name"] for p in res["photos"]] == ["Ерлан"] and res["photos"][0]["receiver_name"] == "Айгерим"
    assert res["my_exchange"]["photo_url"] == res["photos"][0]["url"]
    assert res["pairs"][0]["has_photo"] is True

    img = c.get("/api" + out["url"])
    assert img.status_code == 200 and img.headers["content-type"] == "image/jpeg" and img.content.startswith(b"\xff\xd8")

    # A second photo replaces the first rather than adding another.
    c.post(f"/api/exchange/{env.pair.id}/photo", json={"photo": JPEG}, headers=env.h(env.receiver))
    assert env.db.query(ExchangePhoto).count() == 1


def test_only_the_pair_may_send_and_a_photo_must_be_one(env):
    c = env.client
    assert c.post(f"/api/exchange/{env.pair.id}/photo", json={"photo": JPEG}, headers=env.h(env.stranger)).status_code == 403
    bad = c.post(f"/api/exchange/{env.pair.id}/photo", json={"photo": "data:text/plain;base64,aGk="}, headers=env.h(env.giver))
    assert bad.status_code == 400 and bad.json()["detail"] == "bad_photo"


def test_hidden_or_removed_photos_leave_the_results(env):
    c = env.client
    out = c.post(f"/api/exchange/{env.pair.id}/photo", json={"photo": JPEG}, headers=env.h(env.giver)).json()
    row = env.db.query(ExchangePhoto).one()
    row.hidden = True
    env.db.commit()
    assert c.get(f"/api/rounds/{env.round.id}/results", headers=env.h(env.giver)).json()["photos"] == []
    assert c.get("/api" + out["url"]).status_code == 404

    row.hidden = False
    env.db.commit()
    assert c.delete(f"/api/exchange/{env.pair.id}/photo", headers=env.h(env.giver)).status_code == 204
    assert c.get(f"/api/rounds/{env.round.id}/results", headers=env.h(env.giver)).json()["photos"] == []
