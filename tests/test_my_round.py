"""«Мой месяц»: when the reader reads and logs, the room's part, kudos, and records (GET /rounds/{id}/my-stats)."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

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
from app.models.reaction import ReadingLogReaction
from app.models.reading_room import ReadingRoomSession
from app.models.round import ReadingLog, Round, RoundParticipant
from app.models.user import User


def almaty(day: int, hour: int, month: int = 10) -> datetime:
    """A moment in Almaty time (UTC+5), as the database keeps it."""
    return datetime(2026, month, day, hour, tzinfo=timezone(timedelta(hours=5))).astimezone(timezone.utc)


@pytest.fixture()
def env():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    db = Session()

    dana = User(username="dana", display_name="Dana", password_hash="x", gender=Gender.female)
    sam = User(username="sam", display_name="Sam", password_hash="x", gender=Gender.male)
    db.add_all([dana, sam])
    db.flush()
    group = Group(name="PowerBook", slug="powerbook", owner_user_id=dana.id)
    db.add(group)
    db.flush()
    past = Round(group_id=group.id, year=2026, month=9, status=RoundStatus.closed, timezone="Asia/Almaty")
    rnd = Round(group_id=group.id, year=2026, month=10, status=RoundStatus.locked, timezone="Asia/Almaty")
    db.add_all([past, rnd])
    db.flush()
    db.add(RoundParticipant(round_id=past.id, user_id=dana.id, status=RoundParticipantStatus.active))
    db.add(RoundParticipant(round_id=rnd.id, user_id=dana.id, status=RoundParticipantStatus.active))
    # September: a modest month, best day 50 minutes, a streak of 2
    for d, m in [(1, 30), (2, 50), (4, 20)]:
        db.add(ReadingLog(round_id=past.id, user_id=dana.id, date=date(2026, 9, d), minutes=m, score=1 if m >= 30 else 0))
    # October: three days, logged in the evening of the day (and one filled in two days later), best day 90
    logs = []
    for d, m, created in [(1, 40, almaty(1, 21)), (2, 90, almaty(2, 22)), (3, 35, almaty(5, 9))]:
        log = ReadingLog(round_id=rnd.id, user_id=dana.id, date=date(2026, 10, d), minutes=m, score=1)
        db.add(log)
        db.flush()
        log.created_at = created
        logs.append(log)
    db.add(ReadingLogReaction(reading_log_id=logs[1].id, user_id=sam.id, emoji="🔥"))
    # two sittings in the room this round, one at 7 in the morning and a long one at night; a false start too
    for started, seconds, credited in [(almaty(2, 7), 20 * 60, 20), (almaty(2, 22), 50 * 60, 50), (almaty(3, 12), 60, 0)]:
        s = ReadingRoomSession(
            user_id=dana.id, hall="round", round_id=rnd.id, seat=1, book_title="A book", status="ended",
            accumulated_seconds=seconds, ended_at=started + timedelta(seconds=seconds), credited_minutes=credited,
            credited_round_id=rnd.id if credited else None, credited_date=date(2026, 10, 2) if credited else None,
        )
        db.add(s)
        db.flush()
        s.created_at = started
    db.commit()

    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    client = TestClient(app)
    headers = {"Authorization": f"Bearer {create_access_token(subject=str(dana.id))}"}
    yield {"db": db, "rnd": rnd, "client": client, "headers": headers}
    db.close()


def test_my_stats_tell_when_how_and_what_was_beaten(env):
    r = env["client"].get(f"/api/rounds/{env['rnd'].id}/my-stats", headers=env["headers"])
    assert r.status_code == 200, r.text
    d = r.json()
    # two days logged in the evening (21, 22), one in the morning two days later
    assert d["log_hours"][21] == 1 and d["log_hours"][22] == 1 and d["log_hours"][9] == 1
    assert d["logged_on_the_day"] == 2 and d["logged_later"] == 1
    # the room: two real sittings (the one-minute false start is not one), 70 minutes credited, the longest 50
    assert d["room"]["sittings"] == 2 and d["room"]["minutes"] == 70 and d["room"]["longest_minutes"] == 50
    assert d["room"]["hours"][7] == 1 and d["room"]["hours"][22] == 1 and d["room"]["days"] == 1
    assert d["reactions_received"] == 1 and d["shares"] == 0
    # records: the best day ever is 90 (this round), the longest streak 3 (1–3 Oct), September was the best full round so far
    rec = d["records"]
    assert rec["best_day"] == {"date": "2026-10-02", "minutes": 90}
    assert rec["longest_streak"] == 3
    assert rec["best_round_minutes"] == 100 and rec["best_round_month"] == 9
    assert rec["rounds"] == 2
    # this round has already beaten September's minutes (165 > 100), streak (3 > 2) and best day (90 > 50), goal days (3 > 2)
    assert set(rec["new_this_round"]) == {"minutes", "goal_days", "streak", "best_day"}


def test_my_stats_for_a_first_round(env):
    """A reader with no earlier round: records come from this round alone and nothing is «new» yet."""
    db = env["db"]
    rnd = env["rnd"]
    sam = db.query(User).filter_by(username="sam").one()
    db.add(RoundParticipant(round_id=rnd.id, user_id=sam.id, status=RoundParticipantStatus.active))
    db.add(ReadingLog(round_id=rnd.id, user_id=sam.id, date=date(2026, 10, 1), minutes=45, score=1))
    db.commit()
    headers = {"Authorization": f"Bearer {create_access_token(subject=str(sam.id))}"}
    r = env["client"].get(f"/api/rounds/{rnd.id}/my-stats", headers=headers)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["records"]["best_day"] == {"date": "2026-10-01", "minutes": 45}
    assert d["records"]["best_round_minutes"] is None and d["records"]["new_this_round"] == []
    assert d["room"]["sittings"] == 0 and d["reactions_received"] == 0
