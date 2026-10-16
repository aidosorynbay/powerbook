"""«Битва кланов»: sign-up, the even split, strikes and shields from the circle's own days."""
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
from app.core.constants import ROUND_TZ
from app.models.clan_war import ClanWar
from app.models.enums import Gender, RoundParticipantStatus, RoundStatus, SystemRole
from app.models.group import Group
from app.models.round import ReadingLog, Round, RoundParticipant
from app.models.user import User
from app.services import clan_war, leagues


@pytest.fixture()
def env(monkeypatch):
    leagues.reset_cache()
    monkeypatch.setattr(clan_war, "_today", lambda: date(2026, 10, 18))
    monkeypatch.setattr(clan_war, "_now", lambda: datetime(2026, 10, 16, 12, 0, tzinfo=ROUND_TZ))
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False, autocommit=False)()
    admin = User(username="madiyar", display_name="Madiyar", password_hash="x", gender=Gender.male, system_role=SystemRole.admin)
    readers = [User(username=f"r{i}", display_name=f"R{i}", password_hash="x", gender=Gender.female) for i in range(4)]
    db.add_all([admin, *readers])
    db.flush()
    group = Group(name="PowerBook", slug="powerbook", owner_user_id=admin.id)
    db.add(group)
    db.flush()
    rnd = Round(group_id=group.id, year=2026, month=10, status=RoundStatus.registration_open)
    db.add(rnd)
    db.flush()
    for u in readers:
        db.add(RoundParticipant(round_id=rnd.id, user_id=u.id, status=RoundParticipantStatus.active))
    db.add(ClanWar(start_date=date(2026, 10, 17), end_date=date(2026, 10, 30), status="signup"))
    db.commit()

    app = create_app()

    def _db():
        yield db

    app.dependency_overrides[get_db] = _db
    yield db, TestClient(app), admin, readers, rnd
    leagues.reset_cache()


def h(u):
    return {"Authorization": f"Bearer {create_access_token(subject=str(u.id))}"}


def read(db, rnd, u, d):
    db.add(ReadingLog(round_id=rnd.id, user_id=u.id, date=d, minutes=40, score=1))
    db.commit()


def test_anyone_watches_readers_join_and_the_founder_splits(env):
    db, c, admin, readers, rnd = env
    assert c.get("/api/war").json()["status"] == "signup"
    for u in readers:
        assert c.post("/api/war/join", headers=h(u)).status_code == 200
    body = c.get("/api/war").json()
    assert body["joined_count"] == 4 and len(body["joined"]) == 4
    assert c.post("/api/war/split", headers=h(readers[0])).status_code == 403
    body = c.post("/api/war/split", headers=h(admin)).json()
    assert body["status"] == "live"
    assert [t["size"] for t in body["teams"]] == [2, 2]
    assert c.post("/api/war/leave", headers=h(readers[0])).status_code == 409


def test_points_lock_at_midnight_and_knock_out_bricks(env, monkeypatch):
    db, c, admin, readers, rnd = env
    monkeypatch.setattr(clan_war, "_today", lambda: date(2026, 10, 17))
    for u in readers:
        c.post("/api/war/join", headers=h(u))
    body = c.post("/api/war/split", headers=h(admin)).json()
    team_of = {m["display_name"]: t["key"] for t in body["teams"] for m in t["members"]}
    light = [u for u in readers if team_of[u.display_name] == "lighthouse"]
    sail = [u for u in readers if team_of[u.display_name] == "sail"]
    # 17 Oct: the whole lighthouse reads (2 points), half the sail (1 point)
    for u in light:
        read(db, rnd, u, date(2026, 10, 17))
    read(db, rnd, sail[0], date(2026, 10, 17))
    monkeypatch.setattr(clan_war, "_today", lambda: date(2026, 10, 18))
    monkeypatch.setattr(clan_war, "_now", lambda: datetime(2026, 10, 16, 12, 0, tzinfo=ROUND_TZ))
    body = c.get("/api/war", headers=h(light[0])).json()  # it is the 18th: the 17th is locked
    t = {x["key"]: x for x in body["teams"]}
    assert t["lighthouse"]["days"][0] == {"date": "2026-10-17", "hits": 2, "size": 2, "locked": True}
    assert t["sail"]["bricks"] == 28 and t["sail"]["bricks_left"] == 26  # 2 members × 14 days, 2 strikes
    assert t["lighthouse"]["bricks_left"] == 27
    assert t["lighthouse"]["points"] == 2 and t["lighthouse"]["today"] == 0
    assert t["lighthouse"]["shelf"] == 28 and t["lighthouse"]["fill"] == round(100 * 2 / 28, 1)
    assert body["me"]["hits"] == 1 and body["me"]["days"] == 2 and body["me"]["today"] is False
    # a late log for the locked day changes nothing
    read(db, rnd, sail[1], date(2026, 10, 17))
    t = {x["key"]: x for x in c.get("/api/war").json()["teams"]}
    assert t["lighthouse"]["bricks_left"] == 27
    # today's points show live, and strike only after midnight
    read(db, rnd, sail[1], date(2026, 10, 18))
    t = {x["key"]: x for x in c.get("/api/war").json()["teams"]}
    assert t["sail"]["today"] == 1 and t["lighthouse"]["bricks_left"] == 27


def test_sign_up_closes_at_20_and_the_teams_split_themselves(env, monkeypatch):
    db, c, admin, readers, rnd = env
    for u in readers[:3]:
        assert c.post("/api/war/join", headers=h(u)).status_code == 200
    monkeypatch.setattr(clan_war, "_now", lambda: datetime(2026, 10, 16, 20, 0, 30, tzinfo=ROUND_TZ))
    assert c.post("/api/war/join", headers=h(readers[3])).status_code == 409  # too late
    monkeypatch.setattr(clan_war, "get_session_factory", None, raising=False)
    from app.db import session as session_mod

    monkeypatch.setattr(session_mod, "get_session_factory", lambda: (lambda: db))
    monkeypatch.setattr(db, "close", lambda: None)
    clan_war.scheduled()
    body = c.get("/api/war").json()
    assert body["status"] == "live"
    assert sorted(t["size"] for t in body["teams"]) == [1, 2]
    clan_war.scheduled()  # a second worker finds it split already: nothing happens
    assert c.get("/api/war").json()["status"] == "live"


def test_a_guest_from_outside_the_circle_logs_on_the_war_page(env, monkeypatch):
    db, c, admin, readers, rnd = env
    guest = User(username="guest", display_name="Guest", password_hash="x", gender=Gender.female)
    db.add(guest)
    db.commit()
    monkeypatch.setattr(clan_war, "_today", lambda: date(2026, 10, 17))
    assert c.post("/api/war/join", headers=h(guest)).json()["me"]["guest"] is True
    c.post("/api/war/join", headers=h(readers[0]))
    c.post("/api/war/split", headers=h(admin))
    assert c.post("/api/war/read", json={"minutes": 40}, headers=h(readers[0])).status_code == 409  # circle members use the dial
    body = c.post("/api/war/read", json={"minutes": 35}, headers=h(guest)).json()
    assert body["me"]["today"] is True and body["me"]["minutes"] == 35
    team = next(t for t in body["teams"] if any(m["display_name"] == "Guest" for m in t["members"]))
    assert team["today"] == 1
    # nothing of it in the circle
    assert db.query(RoundParticipant).filter_by(user_id=guest.id).count() == 0
    assert db.query(ReadingLog).filter_by(user_id=guest.id).count() == 0
