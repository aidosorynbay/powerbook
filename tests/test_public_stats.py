"""The homepage's «общая казна»: GET /stats/public counts the circle's month and today, never names."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
import app.services.stats as stats_mod
from app.core.cache import stats_cache
from app.core.constants import ROUND_TZ
from app.db.base import Base
from app.models.enums import Gender, RoundParticipantStatus, RoundStatus
from app.models.group import Group
from app.models.reading_room import ReadingRoomSession
from app.models.round import ReadingLog, Round, RoundParticipant
from app.models.user import User
from app.services.stats import StatsService

NOW = datetime(2026, 10, 14, 20, 0, tzinfo=ROUND_TZ)


class _Frozen(datetime):
    @classmethod
    def now(cls, tz=None):
        return NOW.astimezone(tz) if tz else NOW.replace(tzinfo=None)


@pytest.fixture()
def db(monkeypatch):
    monkeypatch.setattr(stats_mod, "datetime", _Frozen)
    stats_cache.clear() if hasattr(stats_cache, "clear") else None
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine, autoflush=False, autocommit=False)()
    yield s
    s.close()


def test_circle_today_counts(db):
    users = [User(username=f"u{i}", display_name=f"U{i}", password_hash="x", gender=Gender.female) for i in range(4)]
    db.add_all(users)
    db.flush()
    group = Group(name="PowerBook", slug="powerbook", owner_user_id=users[0].id)
    db.add(group)
    db.flush()
    rnd = Round(group_id=group.id, year=2026, month=10, status=RoundStatus.locked, timezone="Asia/Almaty")
    db.add(rnd)
    db.flush()
    for u in users:
        db.add(RoundParticipant(round_id=rnd.id, user_id=u.id, status=RoundParticipantStatus.active))
    today = date(2026, 10, 14)
    # yesterday 40 + 30; today: one made the day (35), one logged 10, one wrote 0
    db.add_all([
        ReadingLog(round_id=rnd.id, user_id=users[0].id, date=today - timedelta(days=1), minutes=40, score=1),
        ReadingLog(round_id=rnd.id, user_id=users[1].id, date=today - timedelta(days=1), minutes=30, score=1),
        ReadingLog(round_id=rnd.id, user_id=users[0].id, date=today, minutes=35, score=1),
        ReadingLog(round_id=rnd.id, user_id=users[1].id, date=today, minutes=10, score=0),
        ReadingLog(round_id=rnd.id, user_id=users[2].id, date=today, minutes=0, score=0),
    ])
    # one reader in the room now, one who left the tab an hour ago, one who finished
    seen = NOW.astimezone(timezone.utc)
    for u, last, ended in [(users[3], seen - timedelta(minutes=1), None),
                           (users[2], seen - timedelta(hours=1), None),
                           (users[1], seen - timedelta(minutes=1), seen)]:
        db.add(ReadingRoomSession(user_id=u.id, hall="round", round_id=rnd.id, seat=1, book_title="B",
                                  status="reading", last_seen_at=last, ended_at=ended))
    db.commit()

    out = StatsService(db).get_public_stats()
    assert out.is_round_active
    assert out.current_round_participants == 4
    assert out.round_minutes == 115
    assert out.today_logged == 2
    assert out.today_counted == 1
    assert out.room_now == 1
