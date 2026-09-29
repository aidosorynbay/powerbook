"""The reading room against a throwaway SQLite database: chairs, the timer, «Сегодня», undo, chat and access."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.core.constants import ROUND_TZ
from app.core.security import create_access_token
from app.db.base import Base
from app.db.session import get_db
from app.main import create_app
from app.models.enums import Gender, RoundParticipantStatus, RoundStatus
from app.models.group import Group
from app.models.reading_room import ReadingRoomSession
from app.models.round import ReadingLog, Round, RoundParticipant
from app.models.user import User


@pytest.fixture()
def env():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    db = Session()

    def user(name, gender=Gender.male):
        u = User(username=name, display_name=name.title(), password_hash="x", gender=gender)
        db.add(u)
        db.flush()
        return u

    owner = user("owner")
    group = Group(name="PowerBook", slug="powerbook", owner_user_id=owner.id)
    db.add(group)
    db.flush()
    today = datetime.now(tz=ROUND_TZ).date()
    rnd = Round(group_id=group.id, year=today.year, month=today.month, status=RoundStatus.locked, end_day=None)
    db.add(rnd)
    db.flush()
    reader, guest, other = user("madik"), user("guest", Gender.female), user("aigerim", Gender.female)
    for u in (reader, other):
        db.add(RoundParticipant(round_id=rnd.id, user_id=u.id, status=RoundParticipantStatus.active))
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

    def headers(u):
        return {"Authorization": f"Bearer {create_access_token(subject=str(u.id))}"}

    return type("Env", (), dict(db=db, Session=Session, client=client, h=headers, reader=reader, guest=guest,
                                other=other, rnd=rnd, today=today))


def _age(env, session_id, seconds, *, seen=None):
    """Moves a sitting back in time, as if it had been running for `seconds`."""
    s = env.db.get(ReadingRoomSession, uuid.UUID(session_id))
    now = datetime.now(timezone.utc)
    s.run_started_at = now - timedelta(seconds=seconds)
    s.created_at = now - timedelta(seconds=seconds)
    s.last_seen_at = seen if seen is not None else now
    env.db.commit()


def _last_day_of_round(env) -> bool:
    return env.today == env.rnd.last_day_date


def test_sit_read_finish_goes_into_today(env):
    if _last_day_of_round(env):
        pytest.skip("the round's last day only takes corrections")
    c, h = env.client, env.h(env.reader)
    env.db.add(ReadingLog(round_id=env.rnd.id, user_id=env.reader.id, date=env.today, minutes=12, score=0,
                          comment="глава 3"))
    env.db.commit()

    r = c.post("/api/reading-room/round/sit", json={"seat": 3, "book": "Граф Монте-Кристо"}, headers=h)
    assert r.status_code == 200, r.text
    sid = r.json()["id"]

    st = c.get("/api/reading-room/round/state", headers=h).json()
    assert st["can_sit"] and st["in_round"]
    assert [x["seat"] for x in st["readers"]] == [3]
    assert st["readers"][0]["me"] and st["readers"][0]["gender"] == "male"

    # the chair is taken for someone else
    r = c.post("/api/reading-room/round/sit", json={"seat": 3, "book": "Дюна"}, headers=env.h(env.other))
    assert r.status_code == 409

    _age(env, sid, 25 * 60)
    r = c.post(f"/api/reading-room/sessions/{sid}/finish", headers=h).json()
    assert r["minutes"] == 25 and r["credited"] and r["today_minutes"] == 37
    env.db.expire_all()
    log = env.db.query(ReadingLog).filter_by(user_id=env.reader.id, date=env.today).one()
    assert log.minutes == 37 and log.score == 1 and log.comment == "глава 3"

    r = c.post(f"/api/reading-room/sessions/{sid}/undo", headers=h).json()
    assert r["today_minutes"] == 12
    assert c.post(f"/api/reading-room/sessions/{sid}/undo", headers=h).status_code == 409


def test_pause_stops_the_clock(env):
    c, h = env.client, env.h(env.reader)
    sid = c.post("/api/reading-room/library/sit", json={"seat": 0, "book": "Дюна"}, headers=h).json()["id"]
    _age(env, sid, 10 * 60)
    p = c.post(f"/api/reading-room/sessions/{sid}/pause", headers=h).json()
    assert p["status"] == "paused" and 599 <= p["elapsed_seconds"] <= 601
    st = c.get("/api/reading-room/library/state", headers=h).json()
    assert st["my_session"]["elapsed_seconds"] == p["elapsed_seconds"]
    assert c.post(f"/api/reading-room/sessions/{sid}/resume", headers=h).json()["status"] == "reading"


def test_round_hall_is_for_the_circle(env):
    c, h = env.client, env.h(env.guest)
    st = c.get("/api/reading-room/round/state", headers=h).json()
    assert not st["can_sit"] and st["messages"] == []
    assert c.post("/api/reading-room/round/sit", json={"seat": 0, "book": "x"}, headers=h).status_code == 403
    assert c.post("/api/reading-room/round/messages", json={"text": "привет"}, headers=h).status_code == 403
    # the library is open to everyone, but a guest's minutes have no circle to go to
    sid = c.post("/api/reading-room/library/sit", json={"seat": 1, "book": "Хюгге"}, headers=h).json()["id"]
    _age(env, sid, 5 * 60)
    r = c.post(f"/api/reading-room/sessions/{sid}/finish", headers=h).json()
    assert r["minutes"] == 5 and not r["credited"] and r["reason"] == "not_in_round"


def test_one_sitting_at_a_time_and_bad_chairs(env):
    c, h = env.client, env.h(env.reader)
    a = c.post("/api/reading-room/library/sit", json={"seat": 2, "book": "A"}, headers=h).json()["id"]
    c.post("/api/reading-room/library/sit", json={"seat": 5, "book": "B"}, headers=h)
    st = c.get("/api/reading-room/library/state", headers=h).json()
    assert [x["seat"] for x in st["readers"]] == [5]
    assert env.db.get(ReadingRoomSession, uuid.UUID(a)).ended_at is not None
    assert c.post("/api/reading-room/library/sit", json={"seat": 11, "book": "C"}, headers=h).status_code == 422
    assert c.post("/api/reading-room/library/sit", json={"seat": 1, "book": "   "}, headers=h).status_code == 422
    assert c.get("/api/reading-room/cellar/state", headers=h).status_code == 404
    # someone else's sitting is not mine to end
    assert c.post(f"/api/reading-room/sessions/{a}/finish", headers=env.h(env.other)).status_code == 404


def test_quiet_readers_are_stood_up_and_counted(env):
    if _last_day_of_round(env):
        pytest.skip("the round's last day only takes corrections")
    c = env.client
    sid = c.post("/api/reading-room/round/sit", json={"seat": 1, "book": "Сто лет"}, headers=env.h(env.other)).json()["id"]
    now = datetime.now(timezone.utc)
    # read 40 minutes, then the tab was closed 5 minutes ago
    _age(env, sid, 45 * 60, seen=now - timedelta(minutes=5) + timedelta(seconds=2))
    st = c.get("/api/reading-room/round/state", headers=env.h(env.reader)).json()
    assert st["readers"] == []
    env.db.expire_all()
    log = env.db.query(ReadingLog).filter_by(user_id=env.other.id, date=env.today).one()
    assert log.minutes == 40


def test_chat(env):
    c, h = env.client, env.h(env.reader)
    r = c.post("/api/reading-room/round/messages", json={"text": "  Всем   привет  "}, headers=h)
    assert r.status_code == 200 and r.json()["text"] == "Всем привет"
    assert c.post("/api/reading-room/round/messages", json={"text": "ещё"}, headers=h).status_code == 429
    msgs = c.get("/api/reading-room/round/state", headers=env.h(env.other)).json()["messages"]
    assert [(m["display_name"], m["text"], m["me"]) for m in msgs] == [("Madik", "Всем привет", False)]
    # the library's chat is its own
    assert c.get("/api/reading-room/library/state", headers=h).json()["messages"] == []
    since = msgs[-1]["created_at"]
    assert c.get("/api/reading-room/round/state", params={"since": since}, headers=h).json()["messages"] == []
