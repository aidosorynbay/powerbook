"""The 1st of a month: last month's readers who have not signed up hear the new circle is open — once, from 10:00
Astana time, never those who joined or switched it off (2026-10-15)."""
from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.models.enums import Gender, RoundParticipantStatus, RoundStatus
from app.models.group import Group
from app.models.notification import Notification, NotificationPref
from app.models.round import Round, RoundParticipant
from app.models.user import User
from app.services import new_circle, push

ALMATY = ZoneInfo("Asia/Almaty")


@pytest.fixture()
def env(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False, autocommit=False)()
    users = {}
    for name in ("away", "joined", "muted", "newcomer"):
        users[name] = User(username=name, display_name=name, password_hash="x", gender=Gender.female, telegram_id=name)
        db.add(users[name])
    db.flush()
    group = Group(name="PowerBook", slug="powerbook", owner_user_id=users["away"].id)
    db.add(group)
    db.flush()
    october = Round(group_id=group.id, year=2026, month=10, status=RoundStatus.results_published, registration_open_until_day=10)
    november = Round(group_id=group.id, year=2026, month=11, status=RoundStatus.registration_open, registration_open_until_day=10)
    db.add_all([october, november])
    db.flush()
    for name in ("away", "joined", "muted"):
        db.add(RoundParticipant(round_id=october.id, user_id=users[name].id, status=RoundParticipantStatus.active))
    db.add(RoundParticipant(round_id=november.id, user_id=users["joined"].id, status=RoundParticipantStatus.active))
    db.add(RoundParticipant(round_id=november.id, user_id=users["newcomer"].id, status=RoundParticipantStatus.active))
    db.add(NotificationPref(user_id=users["muted"].id, kind="new_circle", enabled=False))
    db.commit()
    pushed: list = []
    monkeypatch.setattr(push, "send_to_user", lambda _db, user_id, payload: pushed.append((user_id, payload)) or 1)
    yield db, users, pushed
    db.close()


def at(day: int, hour: int) -> datetime:
    return datetime(2026, 11, day, hour, 5, tzinfo=ALMATY).astimezone(timezone.utc)


def test_last_months_reader_hears_once(env):
    db, users, pushed = env
    assert new_circle.tick(db, at(1, 9)) == 0  # before ten in the morning
    assert new_circle.tick(db, at(1, 10)) == 1
    told = db.execute(select(Notification.user_id).where(Notification.kind == "new_circle")).scalars().all()
    assert told == [users["away"].id]
    assert [u for u, _ in pushed] == [users["away"].id]
    assert pushed[0][1]["url"].startswith("/round") and "10" in pushed[0][1]["body"]
    # the scheduler ticks every minute: nobody hears it twice, and on the 2nd nobody hears it at all
    assert new_circle.tick(db, at(1, 11)) == 0
    assert new_circle.tick(db, at(2, 10)) == 0
    assert len(pushed) == 1
