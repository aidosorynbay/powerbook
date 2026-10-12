"""The daily reading reminder: once a day, at the reader's own time, only
while a circle runs, and never on a day whose 30 minutes are already in."""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

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
from app.models.push import PushSubscription, ReadingReminder
from app.models.round import ReadingLog, Round, RoundParticipant
from app.models.user import User
from app.services import push


@pytest.fixture()
def env(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    db = Session()

    dana = User(username="dana", display_name="Dana", password_hash="x", gender=Gender.female)
    db.add(dana)
    db.flush()
    group = Group(name="PowerBook", slug="powerbook", owner_user_id=dana.id)
    db.add(group)
    db.flush()
    rnd = Round(group_id=group.id, year=2026, month=10, status=RoundStatus.locked, timezone="Asia/Almaty")
    db.add(rnd)
    db.flush()
    db.add(RoundParticipant(round_id=rnd.id, user_id=dana.id, status=RoundParticipantStatus.active))
    db.add(ReadingReminder(user_id=dana.id, enabled=True, hour=21, minute=0, tz="Asia/Almaty", locale="ru"))
    db.add(PushSubscription(user_id=dana.id, endpoint="https://push.example/one", p256dh="k", auth="a"))
    db.commit()

    sent: list[dict] = []

    def fake_webpush(**kwargs):
        sent.append(kwargs)

    monkeypatch.setattr(push, "webpush", fake_webpush)

    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    client = TestClient(app)
    headers = {"Authorization": f"Bearer {create_access_token(subject=str(dana.id))}"}
    yield {"db": db, "dana": dana, "rnd": rnd, "sent": sent, "client": client, "headers": headers}
    db.close()


def at(hour: int, minute: int = 0, day: int = 12) -> datetime:
    """A moment on 12 October 2026, given in Almaty time (UTC+5)."""
    return datetime(2026, 10, day, hour - 5, minute, tzinfo=timezone.utc)


def test_reminder_goes_out_once_at_the_chosen_time(env):
    db, sent = env["db"], env["sent"]
    assert push.tick(db, at(20, 50)) == 0
    assert push.tick(db, at(21, 5)) == 1
    payload = sent[0]
    assert payload["subscription_info"]["endpoint"] == "https://push.example/one"
    assert '"title"' in payload["data"] and "/round?source=push" in payload["data"]
    # The same evening again: nothing more.
    assert push.tick(db, at(21, 20)) == 0
    assert push.tick(db, at(23, 0)) == 0
    # Next day, same time: again.
    assert push.tick(db, at(21, 1, day=13)) == 1


def test_no_reminder_when_today_is_already_read(env):
    db, dana, rnd = env["db"], env["dana"], env["rnd"]
    db.add(ReadingLog(round_id=rnd.id, user_id=dana.id, date=date(2026, 10, 12), minutes=30, score=1))
    db.commit()
    assert push.tick(db, at(21, 0)) == 0
    # A short day is not a read day.
    db.add(ReadingLog(round_id=rnd.id, user_id=dana.id, date=date(2026, 10, 13), minutes=10, score=0))
    db.commit()
    assert push.tick(db, at(21, 0, day=13)) == 1


def test_no_reminder_outside_a_running_circle(env):
    db, rnd = env["db"], env["rnd"]
    rnd.status = RoundStatus.results_published
    db.commit()
    assert push.tick(db, at(21, 0)) == 0


def test_dead_subscription_is_dropped(env, monkeypatch):
    db, dana = env["db"], env["dana"]

    class Gone(push.WebPushException):
        def __init__(self):
            super().__init__("gone")
            self.response = type("R", (), {"status_code": 410})()

    def dead(**kwargs):
        raise Gone()

    monkeypatch.setattr(push, "webpush", dead)
    assert push.tick(db, at(21, 0)) == 0
    assert push.subscriptions_for(db, dana.id) == []


def test_api_round_trip(env):
    client, headers, db, dana = env["client"], env["headers"], env["db"], env["dana"]
    key = client.get("/api/push/vapid-public-key").json()["key"]
    assert len(key) > 80 and "=" not in key
    # The same key every time, for both workers.
    assert client.get("/api/push/vapid-public-key").json()["key"] == key

    r = client.post(
        "/api/push/subscribe",
        json={"subscription": {"endpoint": "https://push.example/two", "keys": {"p256dh": "p", "auth": "a"}}, "display_mode": "ios_standalone"},
        headers=headers,
    )
    assert r.status_code == 200
    assert len(push.subscriptions_for(db, dana.id)) == 2

    r = client.put("/api/push/reminder", json={"enabled": True, "hour": 10, "minute": 15, "tz": "Europe/Berlin", "locale": "en"}, headers=headers)
    assert r.status_code == 200 and r.json()["hour"] == 10 and r.json()["subscriptions"] == 2
    assert client.put("/api/push/reminder", json={"enabled": True, "hour": 10, "minute": 0, "tz": "Mars/Olympus", "locale": "ru"}, headers=headers).status_code == 422

    # 10:15 Berlin on 12 October is 08:15 UTC.
    assert push.tick(db, datetime(2026, 10, 12, 8, 20, tzinfo=timezone.utc)) == 2
    assert env["sent"][0]["data"].count("Time to read") + env["sent"][0]["data"].count("book") >= 1

    assert client.post("/api/push/test", headers=headers).json()["sent"] == 2
    assert client.post("/api/push/unsubscribe", json={"endpoint": "https://push.example/two"}, headers=headers).json()["ok"] is True
    assert client.get("/api/push/reminder", headers=headers).json()["subscriptions"] == 1


def test_off_means_silence(env):
    db, dana = env["db"], env["dana"]
    row = db.get(ReadingReminder, dana.id)
    row.enabled = False
    db.commit()
    assert push.tick(db, at(21, 0)) == 0
    assert uuid.UUID(str(dana.id))  # the user is untouched
