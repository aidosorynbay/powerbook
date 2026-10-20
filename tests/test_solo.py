"""Reading outside the circle (solo.py): the founder (2026-10-20) — a reader not in the circle gets a dial and a
calendar of their own, and the reading room's minutes go to their book on the shelf."""
from __future__ import annotations

import uuid
from datetime import date, timedelta

from app.models.manual_book import ManualBook
from app.models.round import ReadingLog
from app.models.solo import SoloDay
from app.services import catalog
from tests.test_reading_room import _age, env  # noqa: F401  (the room's throwaway database)


def _shelf(env, who):
    shelf = env.client.get("/api/library/bookcase", headers=env.h(who)).json()
    return shelf["books"] if isinstance(shelf, dict) else shelf


def test_the_rooms_minutes_go_to_the_book_on_the_shelf_and_the_own_month(env):
    c, h = env.client, env.h(env.guest)  # in the hall, not in the circle
    env.db.add(ManualBook(user_id=env.guest.id, title="Алхимик", title_norm="алхимик"))
    env.db.commit()
    catalog.invalidate()

    sid = c.post("/api/reading-room/round/sit", json={"seat": 2, "book": "алхимик"}, headers=h).json()["id"]
    _age(env, sid, 25 * 60)
    fin = c.post(f"/api/reading-room/sessions/{sid}/finish", headers=h).json()
    assert fin["credited"] and fin["minutes"] == 25 and fin["date"] == str(env.today)

    # one book on the shelf, the one the reader has, with the minutes on it
    (book,) = [b for b in _shelf(env, env.guest)]
    assert book["title"] == "Алхимик" and book["minutes_read"] == 25

    # the reader's own month: today has the minutes and the book
    month = c.get("/api/solo/month", headers=h).json()
    (today,) = [d for d in month["days"] if d["date"] == str(env.today)]
    assert today["minutes"] == 25 and today["books"] == [{"title": "алхимик", "minutes": 25}]
    assert month["total_minutes"] == 25 and month["days_read"] == 1 and month["streak"] == 1
    assert not month["today_in_circle"]
    assert [b["minutes"] for b in month["books"]] == [25]

    # the circle's calendar knows nothing of it
    env.db.expire_all()
    assert not env.db.query(ReadingLog).filter_by(user_id=env.guest.id).count()

    # undo takes it back off the day and the book
    c.post(f"/api/reading-room/sessions/{sid}/undo", headers=h)
    env.db.expire_all()
    assert not env.db.query(SoloDay).filter_by(user_id=env.guest.id).count()
    assert [b["minutes_read"] for b in _shelf(env, env.guest)] == [0]


def test_the_dial_sets_a_day_and_a_room_sitting_adds_to_it(env):
    c, h = env.client, env.h(env.guest)
    r = c.put("/api/solo/day", json={"date": str(env.today), "minutes": 15, "books": [{"title": "Дюна", "minutes": 0}]},
              headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["minutes"] == 15 and r.json()["books"] == [{"title": "Дюна", "minutes": 15}]

    # the room adds to what the dial set, on the same book
    sid = c.post("/api/reading-room/round/sit", json={"seat": 1, "book": "Дюна"}, headers=h).json()["id"]
    _age(env, sid, 20 * 60)
    assert c.post(f"/api/reading-room/sessions/{sid}/finish", headers=h).json()["today_minutes"] == 35

    # winding the dial back without naming books keeps the one book in step
    day = c.put("/api/solo/day", json={"date": str(env.today), "minutes": 30}, headers=h).json()
    assert day["minutes"] == 30 and day["books"] == [{"title": "Дюна", "minutes": 30}]

    # to zero: the day is gone
    assert c.put("/api/solo/day", json={"date": str(env.today), "minutes": 0, "books": []}, headers=h).json()["minutes"] == 0
    env.db.expire_all()
    assert not env.db.query(SoloDay).filter_by(user_id=env.guest.id).count()


def test_the_circles_days_stay_the_circles(env):
    c = env.client
    # a reader of the circle cannot put this month's days into a month of their own
    r = c.put("/api/solo/day", json={"date": str(env.today), "minutes": 10}, headers=env.h(env.reader))
    assert r.status_code == 409
    month = c.get("/api/solo/month", headers=env.h(env.reader)).json()
    assert month["today_in_circle"]
    assert all(d["circle"] for d in month["days"] if env.rnd.covers(date.fromisoformat(d["date"])))

    # nor can anyone write tomorrow or a day long gone
    h = env.h(env.guest)
    assert c.put("/api/solo/day", json={"date": str(env.today + timedelta(days=1)), "minutes": 10}, headers=h).status_code == 409
    assert c.put("/api/solo/day", json={"date": str(env.today - timedelta(days=90)), "minutes": 10}, headers=h).status_code == 409
    # and a day is a day long
    assert c.put("/api/solo/day", json={"date": str(env.today), "minutes": 2000}, headers=h).status_code == 422


def test_the_hall_tag_shows_a_solo_readers_day(env):
    c, h = env.client, env.h(env.guest)
    c.put("/api/solo/day", json={"date": str(env.today), "minutes": 40}, headers=h)
    c.post("/api/reading-room/round/sit", json={"seat": 5, "book": "Дюна"}, headers=h)
    st = c.get("/api/reading-room/round/state", headers=env.h(env.other)).json()
    (tag,) = st["readers"]
    assert tag["today_minutes"] == 40 and not tag["in_round"]
    assert uuid.UUID(tag["user_id"]) == env.guest.id
