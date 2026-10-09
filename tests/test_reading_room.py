"""The reading room against a throwaway SQLite database: chairs, the timer, the reading day, undo, chat and access."""
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
from app.services import reading_room
from app.services.reading_room import reading_day, reading_day_start


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
    now_local = datetime.now(tz=ROUND_TZ).date()
    rnd = Round(group_id=group.id, year=now_local.year, month=now_local.month, status=RoundStatus.locked, end_day=None)
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
                                other=other, rnd=rnd, today=reading_day()))


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


def test_round_hall_is_open_but_only_the_circle_is_counted(env):
    c, h = env.client, env.h(env.guest)
    st = c.get("/api/reading-room/round/state", headers=h).json()
    assert st["can_sit"] and not st["in_round"]
    # anyone may sit in the circle's room and talk there ...
    sid = c.post("/api/reading-room/round/sit", json={"seat": 1, "book": "Хюгге"}, headers=h).json()["id"]
    assert c.post("/api/reading-room/round/messages", json={"text": "привет"}, headers=h).status_code == 200
    st = c.get("/api/reading-room/round/state", headers=env.h(env.reader)).json()
    assert [(r["seat"], r["in_round"]) for r in st["readers"]] == [(1, False)]
    assert [m["text"] for m in st["messages"]] == ["привет"]
    # ... but a guest's minutes have no circle to go to
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


def test_a_screen_gone_dark_keeps_the_chair_and_asks_about_the_time(env):
    """An iPad on the table locks its screen and Safari stops the page: only the reader knows they kept reading."""
    if _last_day_of_round(env):
        pytest.skip("the round's last day only takes corrections")
    c, h = env.client, env.h(env.other)
    sid = c.post("/api/reading-room/round/sit", json={"seat": 1, "book": "Сто лет"}, headers=h).json()["id"]
    now = datetime.now(timezone.utc)
    # sat down 11 minutes ago; the page last checked in 4½ minutes ago, before the screen went dark
    _age(env, sid, 11 * 60, seen=now - timedelta(seconds=270))

    # someone else in the room: the chair is still taken, its clock stopped where the room last heard from it
    st = c.get("/api/reading-room/round/state", headers=env.h(env.reader)).json()
    [r] = st["readers"]
    assert r["seat"] == 1 and r["status"] == "paused" and 389 <= r["elapsed_seconds"] <= 391
    assert st["day"]["minutes"] == 6
    env.db.expire_all()
    assert env.db.get(ReadingRoomSession, uuid.UUID(sid)).ended_at is None
    assert env.db.query(ReadingLog).filter_by(user_id=env.other.id).count() == 0

    # the reader is back: the dark stretch waits for their word, the clock goes on from now
    s = c.post(f"/api/reading-room/sessions/{sid}/heartbeat", headers=h).json()
    assert s["status"] == "reading" and 389 <= s["elapsed_seconds"] <= 391 and 269 <= s["away_seconds"] <= 271
    st = c.get("/api/reading-room/round/state", headers=env.h(env.reader)).json()
    assert st["readers"][0]["status"] == "reading"
    # «yes, I was reading»: the time counts
    s = c.post(f"/api/reading-room/sessions/{sid}/away", json={"count": True}, headers=h).json()
    assert s["away_seconds"] == 0 and 659 <= s["elapsed_seconds"] <= 661
    r = c.post(f"/api/reading-room/sessions/{sid}/finish", headers=h).json()
    assert r["minutes"] == 11 and r["credited"]


def test_a_silence_not_read_through_is_left_out(env):
    c, h = env.client, env.h(env.reader)
    sid = c.post("/api/reading-room/library/sit", json={"seat": 0, "book": "Дюна"}, headers=h).json()["id"]
    now = datetime.now(timezone.utc)
    _age(env, sid, 11 * 60, seen=now - timedelta(seconds=270))
    # the reader's own page asking for the room is word from them: the question is there on any device
    st = c.get("/api/reading-room/library/state", headers=h).json()
    assert 269 <= st["my_session"]["away_seconds"] <= 271 and 389 <= st["my_session"]["elapsed_seconds"] <= 391
    s = c.post(f"/api/reading-room/sessions/{sid}/away", json={"count": False}, headers=h).json()
    assert s["away_seconds"] == 0 and 389 <= s["elapsed_seconds"] <= 391


def test_a_page_back_after_hours_does_not_bring_the_sitting_back(env):
    c, h = env.client, env.h(env.reader)
    sid = c.post("/api/reading-room/library/sit", json={"seat": 0, "book": "Дюна"}, headers=h).json()["id"]
    now = datetime.now(timezone.utc)
    # read 20½ minutes, then nothing for three hours: the tab was left, and now it wakes up
    seen = now - timedelta(hours=3)
    _age(env, sid, int((now - seen).total_seconds()) + 20 * 60 + 30, seen=seen)
    s = c.post(f"/api/reading-room/sessions/{sid}/heartbeat", headers=h).json()
    assert s["status"] == "ended" and s["away_seconds"] == 0
    env.db.expire_all()
    assert env.db.get(ReadingRoomSession, uuid.UUID(sid)).accumulated_seconds // 60 == 20
    assert c.get("/api/reading-room/library/state", headers=h).json()["my_session"] is None


def test_gone_readers_are_stood_up_and_counted(env):
    if _last_day_of_round(env):
        pytest.skip("the round's last day only takes corrections")
    c = env.client
    sid = c.post("/api/reading-room/round/sit", json={"seat": 1, "book": "Сто лет"}, headers=env.h(env.other)).json()["id"]
    now = datetime.now(timezone.utc)
    # read 40½ minutes, then the tab was closed and nothing was heard from it for over two hours
    seen = now - timedelta(hours=2, minutes=5)
    _age(env, sid, int((now - seen).total_seconds()) + 40 * 60 + 30, seen=seen)
    day = reading_day(seen)
    if not env.rnd.covers(day) or day == env.rnd.last_day_date:
        pytest.skip("the day they left is not one this round takes minutes for")
    st = c.get("/api/reading-room/round/state", headers=env.h(env.reader)).json()
    assert st["readers"] == []
    env.db.expire_all()
    # their minutes go to the reading day they left on
    log = env.db.query(ReadingLog).filter_by(user_id=env.other.id).one()
    assert log.minutes == 40 and log.date == day


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


def test_reading_day_turns_at_three():
    # Astana is UTC+5: 20:59 UTC on the 29th is 01:59 on the 30th there, still the 29th's reading
    assert str(reading_day(datetime(2026, 9, 29, 20, 59, tzinfo=timezone.utc))) == "2026-09-29"
    assert str(reading_day(datetime(2026, 9, 29, 22, 0, tzinfo=timezone.utc))) == "2026-09-30"


def test_the_day_in_the_chat(env):
    c = env.client
    a = c.post("/api/reading-room/library/sit", json={"seat": 0, "book": "Дюна"}, headers=env.h(env.reader)).json()["id"]
    _age(env, a, 20 * 60)
    c.post(f"/api/reading-room/sessions/{a}/finish", headers=env.h(env.reader))
    # a chair taken by mistake leaves no trace
    b = c.post("/api/reading-room/library/sit", json={"seat": 1, "book": "x"}, headers=env.h(env.guest)).json()["id"]
    c.post(f"/api/reading-room/sessions/{b}/finish", headers=env.h(env.guest))
    c.post("/api/reading-room/library/sit", json={"seat": 2, "book": "Сто лет"}, headers=env.h(env.other))
    day = c.get("/api/reading-room/library/state", headers=env.h(env.guest)).json()["day"]
    assert day["date"] == str(env.today) and day["readers"] == 2 and day["minutes"] == 20
    # (SQLite keeps whole seconds for created_at, so the last two may share a second)
    ev = [(e["kind"], e["display_name"], e.get("minutes")) for e in day["events"]]
    assert ev[0] == ("sit", "Madik", None) and sorted(ev[1:]) == [("finish", "Madik", 20), ("sit", "Aigerim", None)]
    sat = next(e for e in day["events"] if e["display_name"] == "Aigerim")
    assert sat["gender"] == "female" and sat["book"] == "Сто лет"
    # the round's hall has its own day
    assert c.get("/api/reading-room/round/state", headers=env.h(env.guest)).json()["day"]["readers"] == 0


def test_after_three_the_reader_picks_the_day(env, monkeypatch):
    """Sat down at 02:40, got up at 03:20: the day has turned under the sitting, so the reader says which day it was."""
    yesterday = env.today - timedelta(days=1)
    if not env.rnd.covers(yesterday) or env.today == env.rnd.last_day_date or yesterday == env.rnd.last_day_date:
        pytest.skip("this round does not take minutes for both days")
    turn = reading_day_start(env.today)
    monkeypatch.setattr(reading_room, "_now", lambda: turn + timedelta(minutes=20))
    c, h = env.client, env.h(env.reader)
    sid = c.post("/api/reading-room/round/sit", json={"seat": 3, "book": "Дюна"}, headers=h).json()["id"]
    s = env.db.get(ReadingRoomSession, uuid.UUID(sid))
    s.created_at = s.run_started_at = turn - timedelta(minutes=40)
    s.last_seen_at = turn + timedelta(minutes=20)
    env.db.commit()

    mine = c.get("/api/reading-room/round/state", headers=h).json()["my_session"]
    assert mine["days"] == [str(yesterday), str(env.today)]
    r = c.post(f"/api/reading-room/sessions/{sid}/finish", json={"day": str(yesterday)}, headers=h).json()
    assert r["minutes"] == 60 and r["credited"] and r["date"] == str(yesterday)
    env.db.expire_all()
    assert env.db.query(ReadingLog).filter_by(user_id=env.reader.id, date=yesterday).one().minutes == 60
    assert env.db.query(ReadingLog).filter_by(user_id=env.reader.id, date=env.today).count() == 0
    # undo takes them back out of the day they went to
    c.post(f"/api/reading-room/sessions/{sid}/undo", headers=h)
    env.db.expire_all()
    assert env.db.query(ReadingLog).filter_by(user_id=env.reader.id, date=yesterday).one().minutes == 0


def test_a_day_not_offered_is_not_taken(env, monkeypatch):
    """In the afternoon a sitting begun after 03:00 is today's: nothing to ask, and a day sent anyway is ignored."""
    if _last_day_of_round(env):
        pytest.skip("the round's last day only takes corrections")
    turn = reading_day_start(env.today)
    monkeypatch.setattr(reading_room, "_now", lambda: turn + timedelta(hours=12))
    c, h = env.client, env.h(env.reader)
    sid = c.post("/api/reading-room/round/sit", json={"seat": 4, "book": "Дюна"}, headers=h).json()["id"]
    s = env.db.get(ReadingRoomSession, uuid.UUID(sid))
    s.created_at = s.run_started_at = turn + timedelta(hours=11, minutes=30)
    s.last_seen_at = turn + timedelta(hours=12)
    env.db.commit()
    assert c.get("/api/reading-room/round/state", headers=h).json()["my_session"]["days"] == []
    r = c.post(f"/api/reading-room/sessions/{sid}/finish", json={"day": str(env.today - timedelta(days=5))}, headers=h).json()
    assert r["minutes"] == 30 and r["date"] == str(env.today)


def test_small_hours_ask_and_guests_are_not_asked(env, monkeypatch):
    """At 04:00 even a sitting begun after the turn may be last night's reading; a guest has no days to choose from."""
    yesterday = env.today - timedelta(days=1)
    if not env.rnd.covers(yesterday) or env.today == env.rnd.last_day_date or yesterday == env.rnd.last_day_date:
        pytest.skip("this round does not take minutes for both days")
    turn = reading_day_start(env.today)
    monkeypatch.setattr(reading_room, "_now", lambda: turn + timedelta(hours=1))
    c = env.client
    for who, seat in ((env.reader, 5), (env.guest, 6)):
        sid = c.post("/api/reading-room/round/sit", json={"seat": seat, "book": "Дюна"}, headers=env.h(who)).json()["id"]
        s = env.db.get(ReadingRoomSession, uuid.UUID(sid))
        s.created_at = s.run_started_at = turn + timedelta(minutes=20)
        s.last_seen_at = turn + timedelta(hours=1)
        env.db.commit()
    assert c.get("/api/reading-room/round/state", headers=env.h(env.reader)).json()["my_session"]["days"] == [str(yesterday), str(env.today)]
    assert c.get("/api/reading-room/round/state", headers=env.h(env.guest)).json()["my_session"]["days"] == []


def test_the_rooms_minutes_go_to_the_book_everywhere(env):
    """The book one sits down with gets the sitting's minutes: on the day («Что читаю»), on the shelf (a book not
    finished stands there as «Читаю», spellings together), in the hall's tags; undo takes them off the book."""
    if _last_day_of_round(env):
        pytest.skip("the round's last day only takes corrections")
    from app.models.round import ReadingLogBook
    from app.services import catalog

    c, h = env.client, env.h(env.reader)
    # yesterday on «Что читаю», spelled another way
    yesterday = env.today - timedelta(days=1)
    log = ReadingLog(round_id=env.rnd.id, user_id=env.reader.id, date=yesterday, minutes=30, score=1)
    env.db.add(log)
    env.db.flush()
    env.db.add(ReadingLogBook(reading_log_id=log.id, user_id=env.reader.id, title="граф монте-кристо",
                              title_norm="граф монте-кристо", minutes=30, finished=False, position=0))
    env.db.commit()
    catalog.invalidate()

    sid = c.post("/api/reading-room/round/sit", json={"seat": 3, "book": "Граф Монте-Кристо"}, headers=h).json()["id"]
    tag = c.get("/api/reading-room/round/state", headers=h).json()["readers"][0]
    assert tag["book_minutes"] == 30
    _age(env, sid, 20 * 60)
    assert c.post(f"/api/reading-room/sessions/{sid}/finish", headers=h).json()["credited"]

    env.db.expire_all()
    books = env.db.query(ReadingLogBook).join(ReadingLog).filter(ReadingLog.date == env.today).all()
    assert [(b.title, b.minutes) for b in books] == [("Граф Монте-Кристо", 20)]

    shelf = c.get("/api/library/bookcase", headers=h).json()
    shelf = shelf["books"] if isinstance(shelf, dict) else shelf
    mine = [b for b in shelf if b["status"] == "reading"]
    assert len(mine) == 1 and mine[0]["source"] == "log"
    assert mine[0]["minutes_read"] == 50 and mine[0]["days_read"] == 2

    rb = c.get(f"/api/rounds/{env.rnd.id}/reading_books", headers=h).json()
    assert rb["minutes"][rb["current"][0]] == 50

    c.post(f"/api/reading-room/sessions/{sid}/undo", headers=h)
    env.db.expire_all()
    assert env.db.query(ReadingLogBook).join(ReadingLog).filter(ReadingLog.date == env.today).count() == 0


def test_a_book_on_the_shelf_does_not_stand_twice(env):
    """A book finished by the day's comment (no «дочитана» on its «Что читаю» row) and read on other days stays one
    book on the shelf, with all its time."""
    from app.models.round import ReadingLogBook
    from app.services import catalog

    c, h = env.client, env.h(env.reader)
    for back, finished in ((3, False), (2, False), (1, True)):
        log = ReadingLog(round_id=env.rnd.id, user_id=env.reader.id, date=env.today - timedelta(days=back), minutes=40,
                         score=1, book_finished=finished, comment="Граф Монте-Кристо 2" if finished else None)
        env.db.add(log)
        env.db.flush()
        env.db.add(ReadingLogBook(reading_log_id=log.id, user_id=env.reader.id, title="Граф Монте-Кристо 2",
                                  title_norm="граф монте-кристо 2", minutes=40, finished=False, position=0))
    env.db.commit()
    catalog.invalidate()
    shelf = c.get("/api/library/bookcase", headers=h).json()
    shelf = shelf["books"] if isinstance(shelf, dict) else shelf
    assert [(b["title"], b["status"], b["minutes_read"]) for b in shelf] == [("Граф Монте-Кристо 2", "finished", 120)]


def test_a_renamed_file_is_the_finished_copy_not_a_second_book(env):
    """The founder's shelf: «Граф Монте-Кристо 2» finished in a round, and the file read for it, named
    «Dumas_Graf_Monte-Kristo_tom2» and renamed on the shelf to «Граф Монте-Кристо 2»: one book, with its file."""
    from app.models.library import LibraryBook
    from app.models.shelf_override import ShelfOverride
    from app.services import catalog

    env.db.add(ReadingLog(round_id=env.rnd.id, user_id=env.reader.id, date=env.today - timedelta(days=1), minutes=40,
                          score=1, book_finished=True, comment="Граф Монте-Кристо 2"))
    up = LibraryBook(user_id=env.reader.id, title="Dumas_Graf_Monte-Kristo_tom2", file_format="epub", file_key="x",
                     file_size=1, progress_percent=40)
    env.db.add(up)
    env.db.flush()
    env.db.add(ShelfOverride(user_id=env.reader.id, volume_key=f"u:{up.id}", title="Граф Монте-Кристо 2", cover_mode="auto"))
    env.db.commit()
    catalog.invalidate()
    shelf = env.client.get("/api/library/bookcase", headers=env.h(env.reader)).json()
    shelf = shelf["books"] if isinstance(shelf, dict) else shelf
    assert [(b["title"], b["status"], b["has_file"]) for b in shelf] == [("Граф Монте-Кристо 2", "finished", True)]


def test_a_comment_taken_off_the_shelf(env):
    """«Убрать с полки»: a finished day's comment that is no book leaves the shelf (others never see it, the owner sees
    it marked, to bring back) and the shared library; the day keeps its minutes and comment."""
    from app.services import catalog

    env.db.add(ReadingLog(round_id=env.rnd.id, user_id=env.reader.id, date=env.today - timedelta(days=1), minutes=40,
                          score=1, book_finished=True, comment="сегодня дочитала, было классно"))
    env.db.commit()
    catalog.invalidate()
    c, me, other = env.client, env.h(env.reader), env.h(env.other)

    def shelf(h, owner=None):
        r = c.get(f"/api/library/bookcase{'/' + str(owner) if owner else ''}", headers=h).json()
        return r["books"] if isinstance(r, dict) else r

    key = shelf(me)[0]["key"]
    assert c.put(f"/api/library/overrides/{key}/hidden", headers=me).status_code == 200
    assert [b["hidden"] for b in shelf(me)] == [True]
    assert shelf(other, env.reader.id) == []
    assert not any("классно" in w.title for w in catalog.index(env.db).works.values())
    env.db.expire_all()
    assert env.db.query(ReadingLog).filter_by(user_id=env.reader.id).one().minutes == 40

    assert c.delete(f"/api/library/overrides/{key}/hidden", headers=me).status_code == 200
    assert [b["hidden"] for b in shelf(me)] == [False]
