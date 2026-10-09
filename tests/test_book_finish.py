"""«Книга прочитана»: the title is found on the shelf or in the shared
library before anything new is made of it, and the reader says from which
day they read the book, so the days they named no book count for it."""
from __future__ import annotations

from datetime import date, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select
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
from app.models.round import ReadingLog, ReadingLogBook, Round, RoundParticipant
from app.models.user import User
from app.services import catalog
from app.services import reading as reading_service


class _Oct20(datetime):
    @classmethod
    def now(cls, tz=None):
        return datetime(2026, 10, 20, 12, 0, tzinfo=tz)


@pytest.fixture()
def env(monkeypatch):
    catalog.invalidate()
    monkeypatch.setattr(reading_service, "datetime", _Oct20)
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    db = Session()

    def user(name):
        u = User(username=name, display_name=name.title(), password_hash="x", gender=Gender.female)
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
    # The shared library: Dana's books, and one Aigerim read before PowerBook.
    db.add_all([
        ManualBook(user_id=dana.id, title="Шантарам", title_norm="шантарам", author="Грегори Робертс"),
        ManualBook(user_id=dana.id, title="Мастер и Маргарита", title_norm="мастер и маргарита", author="Михаил Булгаков"),
        ManualBook(user_id=aigerim.id, title="Теория игр", title_norm="теория игр", author="Авинаш Диксит"),
    ])
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
    h = {"Authorization": f"Bearer {create_access_token(subject=str(aigerim.id))}"}

    def log(day, minutes, books=None, **kw):
        r = client.post(f"/api/rounds/{rnd.id}/reading_logs", json={"date": day.isoformat(), "minutes": minutes, "books": books, **kw}, headers=h)
        assert r.status_code == 200, r.text
        return r.json()

    def check(title, day, **params):
        r = client.get(f"/api/rounds/{rnd.id}/book_finish", params={"title": title, "day": day.isoformat(), **params}, headers=h)
        assert r.status_code == 200, r.text
        return r.json()

    yield type("Env", (), dict(db=db, client=client, h=h, aigerim=aigerim, round=rnd, log=log, check=check))
    catalog.invalidate()


def _titles(found):
    return [c["title"] for c in found["choices"]]


def test_a_finished_title_is_the_book_already_there(env):
    oct7 = date(2026, 10, 7)
    # The same key: that book, nothing to ask.
    found = env.check("шантарам", oct7)
    assert found["exact"] is True and _titles(found) == ["Шантарам"]
    assert found["choices"][0]["on_shelf"] is False and found["choices"][0]["author"] == "Грегори Робертс"
    # Her own book, the way her shelf spells it.
    mine = env.check("«Теория игр» Диксит", oct7)
    assert mine["exact"] is True and mine["choices"][0]["on_shelf"] is True and _titles(mine) == ["Теория игр"]
    # The author typed into the title, a letter missed: «Это она?»
    assert env.check("Мастер и Маргарита Булгаков", oct7)["exact"] is False
    assert "Мастер и Маргарита" in _titles(env.check("Мастер и Маргарита Булгаков", oct7))
    assert _titles(env.check("Шантарм", oct7)) == ["Шантарам"]
    # A book nobody has: a new one, nothing offered.
    new = env.check("Совсем новая книга", oct7)
    assert new["exact"] is False and new["choices"] == []

    # Saved under the picked title, it is the same book on the shelf: one copy, not two.
    env.log(oct7, 30, books=[{"title": "Теория игр", "minutes": 30, "finished": True}], book_finished=True)
    catalog.invalidate()
    shelf = env.client.get("/api/library/bookcase", headers=env.h).json()["books"]
    assert [b["title"] for b in shelf] == ["Теория игр"]


def test_the_days_since_the_book_was_begun_count_for_it(env):
    d = lambda n: date(2026, 10, n)  # noqa: E731
    env.log(d(1), 30, books=[{"title": "Абай жолы", "minutes": 30, "finished": True}], book_finished=True)
    env.log(d(2), 40)  # no book named
    env.log(d(3), 20, books=[{"title": "Шантарам", "minutes": 20}])
    env.log(d(4), 35, books=[{"title": "Сто лет одиночества", "minutes": 35}])  # another book
    env.log(d(6), 50)  # no book named

    # Offered: the day after the last book finished. Oct 4 went to another book.
    found = env.check("Шантарам", d(7), minutes=25)
    assert found["start"] == found["suggested"] == "2026-10-02"
    assert (found["minutes"], found["days"], found["filled_days"]) == (40 + 20 + 50 + 25, 4, 2)
    # A later start never skips a day the book was named on.
    later = env.check("Шантарам", d(7), minutes=25, start="2026-10-05")
    assert later["start"] == "2026-10-03" and later["minutes"] == 20 + 50 + 25

    env.log(d(7), 25, books=[{"title": "Шантарам", "minutes": 25, "finished": True}], book_finished=True, started_on="2026-10-02")
    filled = env.db.execute(select(ReadingLog.date).join(ReadingLogBook).where(ReadingLogBook.filled.is_(True))).scalars().all()
    assert sorted(filled) == [d(2), d(6)]
    catalog.invalidate()
    shelf = env.client.get("/api/library/bookcase", headers=env.h).json()["books"]
    book = next(b for b in shelf if b["title"] == "Шантарам")
    assert (book["minutes_read"], book["days_read"]) == (135, 4)

    # Saved again with a later start: Oct 2 is given back; the form offers the period chosen.
    env.log(d(7), 25, books=[{"title": "Шантарам", "minutes": 25, "finished": True}], book_finished=True, started_on="2026-10-03")
    env.db.expire_all()
    filled = env.db.execute(select(ReadingLog.date).join(ReadingLogBook).where(ReadingLogBook.filled.is_(True))).scalars().all()
    assert filled == [d(6)]
    assert env.check("Шантарам", d(7), minutes=25)["suggested"] == "2026-10-03"

    # The old way, the title in the comment only: the finish day counts too.
    env.log(d(8), 45)
    env.log(d(9), 30, book_finished=True, comment="Мастер и Маргарита\nСупер", started_on="2026-10-08")
    env.db.expire_all()
    rows = env.db.execute(
        select(ReadingLog.date, ReadingLogBook.title, ReadingLogBook.finished).join(ReadingLogBook).where(ReadingLog.date >= d(8))
    ).all()
    assert sorted(rows) == [(d(8), "Мастер и Маргарита", False), (d(9), "Мастер и Маргарита", True)]

    # Read again later: this time starts after the last finish of it.
    again = env.check("Шантарам", d(15), minutes=10)
    assert again["earliest"] == "2026-10-08" and again["suggested"] == "2026-10-10"


def test_two_books_at_once_share_the_days_nobody_named(env):
    d = lambda n: date(2026, 10, n)  # noqa: E731
    env.log(d(1), 30, books=[{"title": "Абай жолы", "minutes": 30, "finished": True}], book_finished=True)
    env.log(d(2), 30, books=[{"title": "Шантарам", "minutes": 30}])
    env.log(d(3), 30, books=[{"title": "Сто лет одиночества", "minutes": 30}])
    env.log(d(4), 40)  # no book named, both open
    env.log(d(5), 30, books=[{"title": "Сто лет одиночества", "minutes": 20}])

    found = env.check("Шантарам", d(6), minutes=25)
    assert (found["minutes"], found["days"], found["shared_with"]) == (30 + 20 + 25, 3, ["Сто лет одиночества"])
    env.log(d(6), 25, books=[{"title": "Шантарам", "minutes": 25, "finished": True}], book_finished=True, started_on="2026-10-02")

    # The second book takes its half of the shared day, not nothing.
    second = env.check("Сто лет одиночества", d(8), minutes=30)
    # Offered from the first day it was named: the book before it was finished after that.
    assert second["start"] == "2026-10-03" and second["minutes"] == 30 + 20 + 20 + 30
    env.log(d(8), 30, books=[{"title": "Сто лет одиночества", "minutes": 30, "finished": True}], book_finished=True,
            started_on="2026-10-03")
    env.db.expire_all()
    oct4 = env.db.execute(select(ReadingLogBook.title, ReadingLogBook.minutes).join(ReadingLog).where(ReadingLog.date == d(4))).all()
    assert sorted(oct4) == [("Сто лет одиночества", 20), ("Шантарам", 20)]

    # Day by day, the reader says how it really was.
    days = env.client.get("/api/library/book-days", params={"title": "Шантарам", "day": "2026-10-06"}, headers=env.h).json()
    by = {x["date"]: x for x in days["days"]}
    assert (days["minutes"], days["days_read"]) == (75, 3)
    assert by["2026-10-04"]["minutes"] == 20 and by["2026-10-04"]["others"] == [{"title": "Сто лет одиночества", "minutes": 20}]
    assert by["2026-10-05"]["offer"] == 10 and by["2026-10-06"]["finish"] is True
    r = env.client.put("/api/library/book-days", json={"title": "Шантарам", "day": "2026-10-06", "days": [
        {"date": "2026-10-02", "minutes": 30}, {"date": "2026-10-04", "minutes": 40}, {"date": "2026-10-05", "minutes": 10},
        {"date": "2026-10-06", "minutes": 25}, {"date": "2026-10-03", "minutes": 0},
    ]}, headers=env.h)
    assert r.status_code == 200, r.text
    assert (r.json()["minutes"], r.json()["days_read"]) == (105, 4)
    # Oct 4 was all «Шантарам»: the other book gives it back; Oct 5 had only 10 minutes free.
    other = env.client.get("/api/library/book-days", params={"title": "Сто лет одиночества", "day": "2026-10-08"}, headers=env.h).json()
    other_by = {x["date"]: x["minutes"] for x in other["days"]}
    assert other_by["2026-10-04"] == 0 and other_by["2026-10-05"] == 20 and other["minutes"] == 30 + 20 + 30
    catalog.invalidate()
    shelf = {b["title"]: b for b in env.client.get("/api/library/bookcase", headers=env.h).json()["books"]}
    assert shelf["Шантарам"]["minutes_read"] == 105
    # From the shelf: the book's own days, whatever title it shows now.
    env.client.put(f"/api/library/overrides/{shelf['Шантарам']['key']}", json={"title": "Шантарам. Книга 1"}, headers=env.h)
    again = env.client.get("/api/library/book-days", params={"volume_key": shelf["Шантарам"]["key"]}, headers=env.h).json()
    assert (again["title"], again["day"], again["minutes"]) == ("Шантарам", "2026-10-06", 105)
