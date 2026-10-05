"""Sharing a reading day, Strava-style: the reader sends the day out, the
link leads to their day page, and whoever signs up from it is remembered as
their guest. Nobody's page is open before they share, and it never shows
what was read or written."""
from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.core.security import create_access_token
from app.db.base import Base
from app.db.session import get_db
from app.main import create_app
from app.models.day_share import DayShare
from app.models.enums import Gender, RoundParticipantStatus, RoundStatus
from app.models.group import Group
from app.models.round import ReadingLog, Round, RoundParticipant
from app.models.user import User
from app.services import day_share

OCT5 = date(2026, 10, 5)


@pytest.fixture()
def env(monkeypatch):
    # Mid-round, so nothing depends on the day the tests run.
    monkeypatch.setattr(day_share, "_today", lambda: OCT5)
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    db = Session()

    def user(name, **kw):
        u = User(username=name, display_name=name.title(), password_hash="x", gender=Gender.female, **kw)
        db.add(u)
        db.flush()
        return u

    aigerim, dana = user("aigerim"), user("dana")
    group = Group(name="PowerBook", slug="powerbook", owner_user_id=dana.id)
    db.add(group)
    db.flush()
    rnd = Round(group_id=group.id, year=2026, month=10, status=RoundStatus.locked, end_day=None, registration_open_until_day=10)
    db.add(rnd)
    db.flush()
    db.add(RoundParticipant(round_id=rnd.id, user_id=aigerim.id, status=RoundParticipantStatus.active))
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

    def read(u, day, minutes, comment=None):
        db.add(ReadingLog(
            round_id=rnd.id, user_id=u.id, date=day, minutes=minutes, score=1 if minutes >= 30 else 0,
            comment=comment,
        ))
        db.commit()

    yield type("Env", (), dict(db=db, client=client, h=h, aigerim=aigerim, dana=dana, round=rnd, read=read, user=user))


def _share(env, u, day=OCT5, channel="whatsapp"):
    return env.client.post(
        "/api/share/day", json={"round_id": str(env.round.id), "day": day.isoformat(), "channel": channel}, headers=env.h(u)
    )


def test_a_day_page_opens_only_once_the_reader_shares_a_day(env):
    for d, m in [(1, 40), (2, 35), (3, 10), (4, 30)]:
        env.read(env.aigerim, date(2026, 10, d), m)
    env.read(env.aigerim, OCT5, 34, comment="Шантарам\nОчень понравилось")

    assert env.client.get("/api/share/r/aigerim").status_code == 404
    assert _share(env, env.aigerim).status_code == 200

    card = env.client.get("/api/share/r/aigerim").json()
    assert card["display_name"] == "Aigerim"
    assert (card["day"], card["day_number"], card["minutes"]) == ("2026-10-05", 5, 34)
    # Oct 3 had 10 minutes: the run is Oct 4 and Oct 5.
    assert card["streak"] == 2
    assert (card["goal_days"], card["total_minutes"]) == (4, 149)
    assert len(card["days"]) == 31 and card["days"][2] == {"date": "2026-10-03", "minutes": 10, "score": 0}
    # Minutes only: the book and the comment stay with the reader.
    assert "Шантарам" not in str(card)
    # However the name is typed.
    assert env.client.get("/api/share/r/@Aigerim").status_code == 200


def test_the_run_of_days_waits_for_a_today_still_short_of_30(env):
    env.read(env.aigerim, date(2026, 10, 3), 30)
    env.read(env.aigerim, date(2026, 10, 4), 45)
    env.read(env.aigerim, OCT5, 12)

    mine = env.client.get(
        "/api/share/day", params={"day": "2026-10-05", "round_id": str(env.round.id)}, headers=env.h(env.aigerim)
    ).json()
    assert (mine["minutes"], mine["streak"], mine["goal_days"]) == (12, 2, 2)
    # Without a round, the day's own month finds it.
    alone = env.client.get("/api/share/day", params={"day": "2026-10-05"}, headers=env.h(env.aigerim)).json()
    assert alone["round_id"] == str(env.round.id)
    # A day already over that missed 30 breaks the run.
    env.read(env.aigerim, date(2026, 10, 6), 0)
    later = env.client.get("/api/share/day", params={"day": "2026-10-07"}, headers=env.h(env.aigerim)).json()
    assert later["streak"] == 0


def test_sharing_is_for_the_circle_and_its_own_days(env):
    assert _share(env, env.dana).status_code == 403
    assert _share(env, env.aigerim, day=date(2026, 11, 1)).status_code == 409
    assert _share(env, env.aigerim, channel="fax").status_code == 422
    assert _share(env, env.aigerim).status_code == 200
    assert _share(env, env.aigerim).status_code == 200
    assert _share(env, env.aigerim, channel="telegram").status_code == 200
    count = env.db.execute(select(func.count()).select_from(DayShare)).scalar_one()
    assert count == 2  # once per day and channel


def test_whoever_signs_up_from_a_shared_link_is_remembered(env):
    def register(name, ref):
        body = {"username": name, "password": "secret1", "display_name": name, "gender": "female", "telegram_id": name}
        if ref is not None:
            body["ref"] = ref
        assert env.client.post("/api/auth/register", json=body).status_code == 200
        return env.db.execute(select(User).where(User.username == name)).scalar_one()

    assert register("guest1", "@Aigerim").invited_by == env.aigerim.id
    assert register("guest2", "nobody").invited_by is None
    assert register("guest3", None).invited_by is None
    assert register("guest4", "x" * 500).invited_by is None

    mine = env.client.get("/api/share/day", params={"day": "2026-10-05"}, headers=env.h(env.aigerim)).json()
    assert mine["invited"] == 1


def test_archive_names_have_no_day_page(env):
    ghost = env.user("old_nick", is_claimable=True)
    env.db.add(DayShare(user_id=ghost.id, round_id=env.round.id, day=OCT5, channel="copy"))
    env.db.commit()
    assert env.client.get("/api/share/r/old_nick").status_code == 404
    assert env.client.get("/api/share/r/nobody").status_code == 404
