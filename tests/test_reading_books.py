"""«Что читаю»: the minutes form remembers the book, a day can be split
between books, and a finished book shows the time the circle gave it."""
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
from app.models.enums import Gender, RoundParticipantStatus, RoundStatus
from app.models.group import Group
from app.models.round import Round, RoundParticipant
from app.models.user import User
from app.services import catalog
from app.services import reading as reading_service
from app.services.bookcase import BookcaseService


class _Sept15(datetime):
    """Mid-September 2026, so the round's dates never depend on the day the tests run."""

    @classmethod
    def now(cls, tz=None):
        return datetime(2026, 9, 15, 12, 0, tzinfo=tz)


@pytest.fixture()
def env(monkeypatch):
    catalog.invalidate()
    monkeypatch.setattr(reading_service, "datetime", _Sept15)
    monkeypatch.setattr(BookcaseService, "_apply_covers", lambda self, volumes, lookups: None)
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    db = Session()
    aigerim = User(username="aigerim", display_name="Aigerim", password_hash="x", gender=Gender.female)
    dana = User(username="dana", display_name="Dana", password_hash="x", gender=Gender.female)
    db.add_all([aigerim, dana])
    db.flush()
    group = Group(name="PowerBook", slug="powerbook", owner_user_id=aigerim.id)
    db.add(group)
    db.flush()
    rnd = Round(group_id=group.id, year=2026, month=9, status=RoundStatus.locked, end_day=None, registration_open_until_day=10)
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
    headers = {"Authorization": f"Bearer {create_access_token(subject=str(aigerim.id))}"}
    dana_headers = {"Authorization": f"Bearer {create_access_token(subject=str(dana.id))}"}
    yield type("Env", (), dict(c=client, h=headers, dana_h=dana_headers, round=rnd, aigerim=aigerim, Session=Session))
    catalog.invalidate()


def _log(env, day: int, **body):
    r = env.c.post(f"/api/rounds/{env.round.id}/reading_logs", json={"date": f"2026-09-{day:02d}", **body}, headers=env.h)
    assert r.status_code == 200, r.text
    return r.json()


def _day(env, day: int, headers=None):
    cal = env.c.get(f"/api/rounds/{env.round.id}/calendar", headers=headers or env.h).json()
    return next(d for d in cal["days"] if d["date"] == f"2026-09-{day:02d}")


def _books(env, minutes=False):
    """«Что читаю»'s titles; with minutes=True, each title's book's minutes so far instead."""
    out = env.c.get(f"/api/rounds/{env.round.id}/reading_books", headers=env.h).json()
    return out.pop("minutes") if minutes else {k: v for k, v in out.items() if k != "minutes"}


def test_one_book_takes_the_whole_day_and_is_offered_next_time(env):
    assert _books(env) == {"current": [], "recent": []}
    out = _log(env, 10, minutes=40, books=[{"title": "  Шантарам ", "minutes": 0}])
    assert out["minutes"] == 40 and out["score"] == 1
    assert out["books"] == [{"title": "Шантарам", "minutes": 40, "finished": False}]
    assert _books(env) == {"current": ["Шантарам"], "recent": []}

    # Changing the day's total moves the one book with it, even from a page
    # that does not send books at all.
    _log(env, 10, minutes=25)
    assert _day(env, 10)["books"] == [{"title": "Шантарам", "minutes": 25, "finished": False}]


def test_a_day_split_between_two_books(env):
    out = _log(env, 11, minutes=0, books=[
        {"title": "Шантарам", "minutes": 20},
        {"title": "Абай жолы", "minutes": 10},
        {"title": "   ", "minutes": 5},  # a blank row is ignored
    ])
    assert out["minutes"] == 30 and out["score"] == 1  # the total follows the split
    assert [(b["title"], b["minutes"]) for b in out["books"]] == [("Шантарам", 20), ("Абай жолы", 10)]
    assert _books(env)["current"] == ["Шантарам", "Абай жолы"]

    # The next day only one of them: the other one waits in «recent».
    _log(env, 12, minutes=30, books=[{"title": "Абай жолы", "minutes": 30}])
    assert _books(env) == {"current": ["Абай жолы"], "recent": ["Шантарам"]}
    assert _books(env, minutes=True) == {"Абай жолы": 40, "Шантарам": 20}


def test_finishing_a_book_puts_its_title_first_and_shows_its_time_on_the_shelf(env):
    _log(env, 10, minutes=45, books=[{"title": "Шантарам", "minutes": 45}])
    _log(env, 11, minutes=30, books=[{"title": "Шантарам", "minutes": 20}, {"title": "Абай жолы", "minutes": 10}])
    out = _log(env, 12, minutes=50, comment="Очень сильная книга", books=[{"title": "Шантарам", "minutes": 50, "finished": True}])
    assert out["book_finished"] is True
    assert out["comment"] == "Шантарам\nОчень сильная книга"
    # Finished: it is no longer «what I'm reading».
    assert _books(env) == {"current": [], "recent": ["Абай жолы"]}

    shelf = env.c.get("/api/library/bookcase", headers=env.h).json()
    book = next(b for b in shelf["books"] if b["title"] == "Шантарам")
    assert (book["minutes_read"], book["days_read"]) == (115, 3)
    assert "Очень сильная книга" in book["note"]


def test_the_old_checkbox_finishes_the_one_book(env):
    out = _log(env, 13, minutes=30, book_finished=True, books=[{"title": "Шантарам", "minutes": 30}])
    assert out["books"][0]["finished"] is True and out["comment"] == "Шантарам"


def test_a_reader_session_adds_to_the_day_and_keeps_what_was_written(env):
    _log(env, 14, minutes=30, book_finished=True, comment="Абай жолы\nКрасиво", books=[{"title": "Абай жолы", "minutes": 30, "finished": True}])
    r = env.c.post(f"/api/rounds/{env.round.id}/reading_logs/session",
                   json={"date": "2026-09-14", "minutes": 15, "title": "Шантарам"}, headers=env.h)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["minutes"] == 45
    assert out["book_finished"] is True and out["comment"] == "Абай жолы\nКрасиво"
    assert [(b["title"], b["minutes"]) for b in out["books"]] == [("Абай жолы", 30), ("Шантарам", 15)]

    # Again on the same book: its minutes grow, no second row.
    out = env.c.post(f"/api/rounds/{env.round.id}/reading_logs/session",
                     json={"date": "2026-09-14", "minutes": 5, "title": "Шантарам"}, headers=env.h).json()
    assert out["minutes"] == 50 and [b["minutes"] for b in out["books"]] == [30, 20]


def test_a_session_without_a_title_only_adds_minutes(env):
    _log(env, 14, minutes=10, comment="мысли")
    out = env.c.post(f"/api/rounds/{env.round.id}/reading_logs/session",
                     json={"date": "2026-09-14", "minutes": 25}, headers=env.h).json()
    assert out["minutes"] == 35 and out["comment"] == "мысли" and out["books"] == []


def test_someone_else_does_not_see_the_days_books(env):
    _log(env, 10, minutes=40, books=[{"title": "Шантарам", "minutes": 40}])
    cal = env.c.get(f"/api/rounds/{env.round.id}/calendar/{env.aigerim.id}", headers=env.dana_h)
    if cal.status_code == 404:
        pytest.skip("no per-user calendar route")
    day = next(d for d in cal.json()["days"] if d["date"] == "2026-09-10")
    assert day["books"] == []


def test_an_ai_letter_whose_writer_died_offers_to_write_again(env):
    """A deploy restarts the server and kills the thread writing a letter:
    after six minutes it reads as interrupted, not as forever «пишется»."""
    import uuid
    from datetime import timedelta, timezone

    from app.models.ai_digest import AiDigest
    from app.services import reading_ai

    s = env.Session()
    try:
        user = s.get(User, env.aigerim.id)
        scope = str(uuid.uuid4())
        row = AiDigest(user_id=user.id, kind="round", scope=scope, lang="ru", input_hash="x", status="working")
        s.add(row)
        s.commit()
        assert reading_ai.get_digest(s, user=user, kind="round", scope=scope, lang="ru").status == "working"

        row.updated_at = datetime.now(timezone.utc) - timedelta(minutes=7)
        s.commit()
        out = reading_ai.get_digest(s, user=user, kind="round", scope=scope, lang="ru")
        assert (out.status, out.error) == ("error", "interrupted")
    finally:
        s.close()
