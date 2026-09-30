"""Getting into the next circle: sign-up while it is open, the waiting list
while it is not, invitations by link, and the place kept when sign-up opens."""
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
from app.models.enums import Gender, RoundParticipantStatus, RoundStatus
from app.models.group import Group
from app.models.round import Round, RoundParticipant
from app.models.user import User
from app.services import waitlist


@pytest.fixture()
def env(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    db = Session()
    reader = User(username="madik", display_name="Madik", password_hash="x", gender=Gender.male)
    newcomer = User(username="aigerim", display_name="Aigerim", password_hash="x", gender=Gender.female)
    db.add_all([reader, newcomer])
    db.flush()
    group = Group(name="PowerBook", slug="powerbook", owner_user_id=reader.id)
    db.add(group)
    db.flush()
    september = Round(group_id=group.id, year=2026, month=9, status=RoundStatus.locked, end_day=None, registration_open_until_day=10)
    db.add(september)
    db.flush()
    db.add(RoundParticipant(round_id=september.id, user_id=reader.id, status=RoundParticipantStatus.active))
    db.commit()

    today = {"d": date(2026, 9, 20)}
    monkeypatch.setattr(waitlist, "_today", lambda: today["d"])

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

    yield type("Env", (), dict(db=db, client=client, h=h, reader=reader, newcomer=newcomer, group=group, september=september, today=today))


def test_mid_month_the_waiting_list_is_for_next_month_and_counts_invitations(env):
    c = env.client
    s = c.get("/api/waitlist", headers=env.h(env.newcomer)).json()
    assert s["phase"] == "waitlist" and (s["year"], s["month"]) == (2026, 10)
    assert s["starts_on"] == "2026-10-01" and s["days_left_in_month"] == 10
    assert not s["in_current_round"] and not s["on_waitlist"] and s["count"] == 0

    r = c.post("/api/waitlist", json={"ref": "@madik"}, headers=env.h(env.newcomer))
    assert r.status_code == 200 and r.json()["on_waitlist"] and r.json()["count"] == 1
    # Twice is once.
    assert c.post("/api/waitlist", json={}, headers=env.h(env.newcomer)).json()["count"] == 1

    mine = c.get("/api/waitlist", headers=env.h(env.reader)).json()
    assert mine["in_current_round"] and mine["invited"] == 1 and mine["ref"] == "madik"
    assert [p["display_name"] for p in mine["people"]] == ["Aigerim"]

    # A visitor without an account sees the count, not the faces.
    anon = c.get("/api/waitlist").json()
    assert anon["count"] == 1 and anon["people"] == [] and anon["ref"] is None

    # Inviting yourself counts for nothing.
    c.post("/api/waitlist", json={"ref": "madik"}, headers=env.h(env.reader))
    assert c.get("/api/waitlist", headers=env.h(env.reader)).json()["invited"] == 1

    left = c.delete("/api/waitlist", headers=env.h(env.newcomer)).json()
    assert not left["on_waitlist"] and left["count"] == 1  # the reader's own entry


def test_while_sign_up_is_open_the_round_itself_is_offered(env):
    env.september.status = RoundStatus.registration_open
    env.db.commit()
    env.today["d"] = date(2026, 9, 4)
    s = env.client.get("/api/waitlist", headers=env.h(env.newcomer)).json()
    assert s["phase"] == "registration" and s["open_round"]["id"] == str(env.september.id)
    assert s["open_round"]["registration_until"] == "2026-09-10" and s["open_round"]["days_left"] == 6
    r = env.client.post("/api/waitlist", json={}, headers=env.h(env.newcomer))
    assert r.status_code == 409 and r.json()["detail"] == "registration_open"


def test_when_sign_up_opens_the_waiting_reader_is_offered_their_place(env):
    c = env.client
    c.post("/api/waitlist", json={}, headers=env.h(env.newcomer))
    # The evening of the last day: October's round is created and open.
    env.today["d"] = date(2026, 9, 30)
    october = Round(group_id=env.group.id, year=2026, month=10, status=RoundStatus.registration_open, end_day=None, registration_open_until_day=10)
    env.db.add(october)
    env.db.commit()
    s = c.get("/api/waitlist", headers=env.h(env.newcomer)).json()
    assert s["phase"] == "registration" and s["open_round"]["month"] == 10
    assert s["on_waitlist"] and s["waited_for_open"] and not s["in_open_round"]

    assert c.post(f"/api/rounds/{october.id}/join", headers=env.h(env.newcomer)).status_code == 200
    s = c.get("/api/waitlist", headers=env.h(env.newcomer)).json()
    assert s["in_open_round"] and not s["waited_for_open"]
