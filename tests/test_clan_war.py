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
    # today's points show live to their own team, and strike only after midnight
    read(db, rnd, sail[1], date(2026, 10, 18))
    t = {x["key"]: x for x in c.get("/api/war", headers=h(sail[0])).json()["teams"]}
    assert t["sail"]["today"] == 1 and t["lighthouse"]["bricks_left"] == 27
    # the rival's running day is hidden until it closes: its count, in the number and in the strip
    assert t["lighthouse"]["today"] is None and t["lighthouse"]["days"][-1]["hits"] is None
    body = c.get("/api/war").json()  # a visitor without a team sees neither team's open day
    assert all(x["today"] is None for x in body["teams"])
    # yesterday's close is offered to the page as the midnight reveal
    assert body["reveal"]["date"] == "2026-10-17" and body["reveal"]["n"] == 1 and body["reveal"]["final"] is False
    assert sorted(body["reveal"]["hits"]) == [1, 2]


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
    assert c.post("/api/war/read", json={"minutes": 35, "day": "yesterday"}, headers=h(guest)).status_code == 409  # guests: today only
    body = c.post("/api/war/read", json={"minutes": 35}, headers=h(guest)).json()
    assert body["me"]["today"] is True and body["me"]["minutes"] == 35
    team = next(t for t in body["teams"] if any(m["display_name"] == "Guest" for m in t["members"]))
    assert team["today"] == 1
    # nothing of it in the circle
    assert db.query(RoundParticipant).filter_by(user_id=guest.id).count() == 0
    assert db.query(ReadingLog).filter_by(user_id=guest.id).count() == 0


def test_a_day_logged_after_its_midnight_counts_for_the_circle_not_the_war(env, monkeypatch):
    db, c, admin, readers, rnd = env
    monkeypatch.setattr(clan_war, "_today", lambda: date(2026, 10, 17))
    for u in readers:
        c.post("/api/war/join", headers=h(u))
    c.post("/api/war/split", headers=h(admin))
    from datetime import timezone as tz
    # the 17th logged at 00:20 on the 18th (Astana) = 19:20 UTC on the 17th
    db.add(ReadingLog(round_id=rnd.id, user_id=readers[0].id, date=date(2026, 10, 17), minutes=45, score=1,
                      created_at=datetime(2026, 10, 17, 19, 20, tzinfo=tz.utc)))
    # the 17th logged at 23:50 the same evening (Astana) = 18:50 UTC
    db.add(ReadingLog(round_id=rnd.id, user_id=readers[1].id, date=date(2026, 10, 17), minutes=45, score=1,
                      created_at=datetime(2026, 10, 17, 18, 50, tzinfo=tz.utc)))
    db.commit()
    monkeypatch.setattr(clan_war, "_today", lambda: date(2026, 10, 18))
    body = c.get("/api/war").json()
    assert sum(t["days"][0]["hits"] for t in body["teams"]) == 1


def test_a_circle_reader_logs_on_the_war_page_into_the_circles_own_day(env, monkeypatch):
    """The war page's form writes the very row the dial writes: one number in both places, comment and finish kept."""
    db, c, admin, readers, rnd = env
    monkeypatch.setattr(clan_war, "_today", lambda: date(2026, 10, 17))
    c.post("/api/war/join", headers=h(readers[0]))
    c.post("/api/war/join", headers=h(readers[1]))
    c.post("/api/war/split", headers=h(admin))
    db.add(ReadingLog(round_id=rnd.id, user_id=readers[0].id, date=date(2026, 10, 17), minutes=10, score=0,
                      comment="Дюна", is_comment_private=False))
    db.commit()
    body = c.post("/api/war/read", json={"minutes": 40}, headers=h(readers[0])).json()
    assert body["me"]["today"] is True and body["me"]["minutes"] == 40
    rows = db.query(ReadingLog).filter_by(user_id=readers[0].id).all()
    assert len(rows) == 1 and rows[0].minutes == 40 and rows[0].comment == "Дюна"
    me = next(t for t in body["teams"] if any(m["display_name"] == "R0" for m in t["members"]))
    assert [p["display_name"] for p in body["me"]["shelf_today"]] == ["R0"]
    assert me["today"] == 1
    # a day-time save cannot go to yesterday
    assert c.post("/api/war/read", json={"minutes": 30, "day": "yesterday"}, headers=h(readers[0])).status_code == 409


def test_after_midnight_a_circle_reader_is_asked_which_day(env, monkeypatch):
    db, c, admin, readers, rnd = env
    monkeypatch.setattr(clan_war, "_today", lambda: date(2026, 10, 17))
    c.post("/api/war/join", headers=h(readers[0]))
    c.post("/api/war/join", headers=h(readers[1]))
    c.post("/api/war/split", headers=h(admin))
    monkeypatch.setattr(clan_war, "_today", lambda: date(2026, 10, 18))
    monkeypatch.setattr(clan_war, "_now", lambda: datetime(2026, 10, 18, 0, 40, tzinfo=ROUND_TZ))
    body = c.get("/api/war", headers=h(readers[0])).json()
    assert body["me"]["ask_day"] is True and body["me"]["minutes_yesterday"] == 0
    body = c.post("/api/war/read", json={"minutes": 45, "day": "yesterday"}, headers=h(readers[0])).json()
    row = db.query(ReadingLog).filter_by(user_id=readers[0].id).one()
    assert row.date == date(2026, 10, 17) and row.minutes == 45  # the circle has it
    assert body["me"]["minutes_yesterday"] == 45 and body["me"]["today"] is False



def _at(day, hh, mm):
    from datetime import timezone

    return datetime(2026, 10, day, hh, mm, tzinfo=ROUND_TZ).astimezone(timezone.utc)


def _split_on_17th(env, monkeypatch):
    db, c, admin, readers, rnd = env
    monkeypatch.setattr(clan_war, "_today", lambda: date(2026, 10, 17))
    for u in readers:
        c.post("/api/war/join", headers=h(u))
    # joined before the start (the real clock would make them join today)
    from app.models.clan_war import ClanWarMember

    for m in db.query(ClanWarMember):
        m.created_at = _at(16, 12, 0)
    db.commit()
    body = c.post("/api/war/split", headers=h(admin)).json()
    team_of = {m["display_name"]: t["key"] for t in body["teams"] for m in t["members"]}
    return [u for u in readers if team_of[u.display_name] == "lighthouse"]


def _sit(db, u, rnd, *, begun, **kw):
    from app.models.reading_room import ReadingRoomSession

    s = ReadingRoomSession(
        user_id=u.id, hall="round", round_id=rnd.id, seat=0, book_title="Три товарища",
        status=kw.pop("status", "reading"), accumulated_seconds=kw.pop("accumulated_seconds", 0),
        run_started_at=kw.pop("run_started_at", begun), last_seen_at=kw.pop("last_seen_at", begun),
        created_at=begun, **kw,
    )
    db.add(s)
    db.commit()
    return s


def test_still_in_the_reading_room_at_midnight_counts_and_i_did_not_read_takes_it_back(env, monkeypatch):
    """Founder 2026-10-22: 23:59, 40 minutes in the chair, nothing saved — the war's 00:00 counts it anyway."""
    db, c, admin, readers, rnd = env
    light = _split_on_17th(env, monkeypatch)
    me = light[0]
    # in the chair since 23:20, the page alive until the very end of the day
    _sit(db, me, rnd, begun=_at(17, 23, 20), last_seen_at=_at(17, 23, 59))
    # the other one sat for 20 minutes only: not a day
    _sit(db, light[1], rnd, begun=_at(17, 23, 40), last_seen_at=_at(17, 23, 59))
    monkeypatch.setattr(clan_war, "_today", lambda: date(2026, 10, 18))
    body = c.get("/api/war", headers=h(me)).json()
    t = {x["key"]: x for x in body["teams"]}
    assert t["lighthouse"]["days"][0]["hits"] == 1
    assert body["me"]["hits"] == 1 and body["me"]["room_read"] == {"date": "2026-10-17", "minutes": 40}
    # «Я не читал(а)»: the point leaves the locked day
    body = c.post("/api/war/not-read", headers=h(me)).json()
    t = {x["key"]: x for x in body["teams"]}
    assert t["lighthouse"]["days"][0]["hits"] == 0
    assert body["me"]["hits"] == 0 and body["me"]["room_read"] is None


def test_room_minutes_top_up_what_was_logged_and_undo_in_the_room_takes_the_day_back(env, monkeypatch):
    from app.services.reading_room import ReadingRoomService

    db, c, admin, readers, rnd = env
    light = _split_on_17th(env, monkeypatch)
    me = light[0]
    # 20 minutes logged in the evening, then the room from 23:45, got up at 00:30 — the sitting went to the 17th's
    # circle log after midnight, too late for the war's own count
    db.add(ReadingLog(round_id=rnd.id, user_id=me.id, date=date(2026, 10, 17), minutes=20, score=0, created_at=_at(17, 20, 0)))
    s = _sit(
        db, me, rnd, begun=_at(17, 23, 45), status="ended", accumulated_seconds=45 * 60, run_started_at=None,
        last_seen_at=_at(18, 0, 30), ended_at=_at(18, 0, 30),
        credited_minutes=45, credited_round_id=rnd.id, credited_date=date(2026, 10, 17),
    )
    monkeypatch.setattr(clan_war, "_today", lambda: date(2026, 10, 18))
    t = {x["key"]: x for x in c.get("/api/war", headers=h(me)).json()["teams"]}
    assert t["lighthouse"]["days"][0]["hits"] == 1  # 20 logged + 15 in the room before 00:00
    # «Отменить» in the room: they were not reading, and the war forgets the day too
    ReadingRoomService(db).undo(session_id=s.id, user=me)
    body = c.get("/api/war", headers=h(me)).json()
    t = {x["key"]: x for x in body["teams"]}
    assert t["lighthouse"]["days"][0]["hits"] == 0 and body["me"]["hits"] == 0


def test_a_silent_page_before_midnight_is_not_counted(env, monkeypatch):
    db, c, admin, readers, rnd = env
    light = _split_on_17th(env, monkeypatch)
    # sat down at 23:00, page went quiet at 23:10 (locked phone) and never answered: 10 minutes only
    _sit(db, light[0], rnd, begun=_at(17, 23, 0), last_seen_at=_at(17, 23, 10))
    monkeypatch.setattr(clan_war, "_today", lambda: date(2026, 10, 18))
    t = {x["key"]: x for x in c.get("/api/war", headers=h(light[0])).json()["teams"]}
    assert t["lighthouse"]["days"][0]["hits"] == 0
