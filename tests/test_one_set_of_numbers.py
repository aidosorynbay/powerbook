"""One reader, one set of numbers: Профиль, «Моё чтение» (all time) and the year card count hours, the best streak and
finished books the same way (2026-10-15: 55 h / 8 days / 0 books on Профиль against 54 h / 9 days and books marked
«дочитана» on «Моё чтение»)."""
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
from app.models.manual_book import ManualBook
from app.models.round import ReadingLog, Round, RoundParticipant
from app.models.user import User
from app.services import catalog


@pytest.fixture()
def env():
    catalog.invalidate()
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    db = Session()
    reader = User(username="reader", display_name="Reader", password_hash="x", gender=Gender.female, telegram_id="reader")
    db.add(reader)
    db.flush()
    group = Group(name="PowerBook", slug="powerbook", owner_user_id=reader.id)
    db.add(group)
    db.flush()
    rnd = Round(group_id=group.id, year=2026, month=9, status=RoundStatus.results_published, registration_open_until_day=10)
    db.add(rnd)
    db.flush()
    db.add(RoundParticipant(round_id=rnd.id, user_id=reader.id, status=RoundParticipantStatus.active))
    # 1–8 September: counted days; the 9th a short day (read, not counted); 10–15 counted again.
    for d in range(1, 16):
        minutes = 20 if d == 9 else 45
        db.add(ReadingLog(round_id=rnd.id, user_id=reader.id, date=date(2026, 9, d), minutes=minutes, score=int(minutes >= 30),
                          comment="Atomic Habits" if d == 15 else None, book_finished=d == 15))
    # read outside the circles, added by hand: a finished book on the shelf
    db.add(ManualBook(user_id=reader.id, title="Маленький принц", title_norm="маленький принц", author="Экзюпери",
                      finished_on=date(2026, 9, 20)))
    db.commit()

    app = create_app()

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _db
    headers = {"Authorization": f"Bearer {create_access_token(subject=str(reader.id))}"}
    yield TestClient(app), headers
    catalog.invalidate()


def test_profile_and_my_reading_agree(env):
    client, h = env
    profile = client.get("/api/insights/profile", headers=h).json()
    overview = client.get("/api/reading/overview?period=all", headers=h).json()
    year = client.get("/api/reading/overview?period=2026", headers=h).json()
    card = client.get("/api/insights/wrapped?year=2026", headers=h).json()

    # hours: the same minutes, rounded down in both places (the page floors them too)
    assert profile["total_minutes"] == overview["minutes"] == 14 * 45 + 20
    assert profile["total_hours"] == overview["minutes"] // 60
    # the best streak is a run of counted days: the short 9th breaks it (8 days, not 15)
    assert profile["longest_streak_days"] == overview["longest_streak"] == year["longest_streak"] == card["longest_streak_days"] == 8
    # finished books are the shelf's: the circle one and the one added by hand
    assert profile["books_finished"] == len(overview["books"]) == len(year["books"]) == card["books_finished"] == 2
