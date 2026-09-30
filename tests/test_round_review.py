"""The personal review of a round: numbers beside the reader's own past rounds,
what went well, where the days went, and the habits offered for it."""
from __future__ import annotations

from datetime import date, timedelta

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
from app.models.enums import Gender, ResultGroup, RoundParticipantStatus, RoundStatus
from app.models.group import Group
from app.models.round import ReadingLog, Round, RoundParticipant, RoundResult
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
    me = User(username="madik", display_name="Madik", password_hash="x", gender=Gender.male)
    others = [User(username=f"r{i}", display_name=f"R{i}", password_hash="x", gender=Gender.female) for i in range(9)]
    db.add_all([me, *others])
    db.flush()
    group = Group(name="PowerBook", slug="powerbook", owner_user_id=me.id)
    db.add(group)
    db.flush()

    def round_of(month, minutes_for, rank, status=RoundStatus.results_published, books=0):
        rnd = Round(group_id=group.id, year=2026, month=month, status=status, end_day=None)
        db.add(rnd)
        db.flush()
        db.add(RoundParticipant(round_id=rnd.id, user_id=me.id, status=RoundParticipantStatus.active))
        day = rnd.first_day_date
        while day <= rnd.last_day_date:
            m = minutes_for(day)
            finished = 28 - books < day.day <= 28
            if m:
                db.add(ReadingLog(round_id=rnd.id, user_id=me.id, date=day, minutes=m, score=int(m >= 30),
                                  book_finished=finished, comment=f"Book {28 - day.day}" if finished else None))
            day += timedelta(days=1)
        if status == RoundStatus.results_published:
            db.add(RoundResult(round_id=rnd.id, user_id=me.id, total_score=0, rank=rank, group=ResultGroup.winner))
            for i, o in enumerate(others):
                db.add(RoundResult(round_id=rnd.id, user_id=o.id, total_score=0, rank=rank + 1 + i, group=ResultGroup.loser))
        return rnd

    # June and July: steady, 40 minutes every day but Sundays.
    june = round_of(6, lambda d: 0 if d.weekday() == 6 else 40, rank=3)
    july = round_of(7, lambda d: 0 if d.weekday() == 6 else 45, rank=2)

    # August: strong first half, then it fades, with a four-day gap and short days.
    def august(d):
        if d.day <= 15:
            return 60
        if 18 <= d.day <= 21:
            return 0
        return 15 if d.day % 2 else 35

    aug = round_of(8, august, rank=6, books=1)
    # One day in August was logged under a second account the reader later claimed.
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
    h = {"Authorization": f"Bearer {create_access_token(subject=str(me.id))}"}
    yield type("Env", (), dict(db=db, client=client, h=h, me=me, june=june, july=july, aug=aug, others=others))


def test_the_last_round_with_results_is_reviewed_against_the_past(env):
    r = env.client.get("/api/reading/round-review", headers=env.h)
    assert r.status_code == 200, r.text
    data = r.json()
    cur, prev, avg = data["round"], data["previous"], data["average"]
    assert (cur["year"], cur["month"]) == (2026, 8)
    # August has 31 days; the 31st is for corrections only.
    assert cur["days"] == 30
    # 1–15 at 60; the 16th at 35 and the 17th at 15; 18–21 nothing; then 35 and 15 in turn.
    assert cur["goal_days"] == 15 + 1 + 5 and cur["partial_days"] == 1 + 4 and cur["missed_days"] == 4
    assert cur["longest_gap"] == 4 and cur["rank"] == 6 and cur["participants"] == 10
    assert cur["books"] == 1
    # July: 30 scoring days, four of them Sundays. June: 29, four Sundays.
    assert (prev["month"], prev["goal_days"]) == (7, 26)
    assert avg["goal_days"] == round((25 + 26) / 2)
    assert [t["month"] for t in data["trend"]] == [6, 7, 8]
    assert [x["month"] for x in data["rounds"]] == [8, 7, 6]

    improve = {i["key"]: i for i in data["improve"]}
    assert improve["fade"]["params"]["pct"] > 30
    assert improve["gaps"]["params"]["n"] == 4
    assert improve["short_days"]["params"]["n"] == 5
    assert "down_from_prev" in improve and improve["down_from_prev"]["params"]["delta"] == 5
    assert len(data["improve"]) <= 4
    assert "mid_month" in data["tips"] and "never_twice" in data["tips"]
    assert len(data["tips"]) <= 5
    strengths = {s["key"] for s in data["strengths"]}
    assert "record_minutes" in strengths and "book" in strengths


def test_an_earlier_round_can_be_chosen_and_the_first_one_says_so(env):
    data = env.client.get(f"/api/reading/round-review?round_id={env.june.id}", headers=env.h).json()
    assert data["round"]["month"] == 6 and data["previous"] is None and data["average"] is None
    assert "first_round" in {s["key"] for s in data["strengths"]}
    # Every Sunday missed: the weakest weekday is Sunday.
    weak = next(i for i in data["improve"] if i["key"] == "weak_weekday")
    assert weak["params"]["weekday"] == 6 and "weekend_plan" in weak["tips"]

    july = env.client.get(f"/api/reading/round-review?round_id={env.july.id}", headers=env.h).json()
    assert {"record_minutes", "top"} <= {s["key"] for s in july["strengths"]}


def test_someone_elses_round_or_no_rounds(env):
    other = env.others[0]
    h = {"Authorization": f"Bearer {create_access_token(subject=str(other.id))}"}
    # Their results exist, so they have a review of their own...
    assert env.client.get("/api/reading/round-review", headers=h).status_code == 200
    # ...but a round they were never in is not theirs to review.
    lonely = User(username="new", display_name="New", password_hash="x", gender=Gender.male)
    env.db.add(lonely)
    env.db.commit()
    h2 = {"Authorization": f"Bearer {create_access_token(subject=str(lonely.id))}"}
    assert env.client.get("/api/reading/round-review", headers=h2).json()["detail"] == "no_rounds"
    assert env.client.get(f"/api/reading/round-review?round_id={env.june.id}", headers=h2).status_code == 404


def test_the_round_letter_waits_for_a_key_and_takes_the_review(env, monkeypatch):
    c = env.client
    r = c.post("/api/reading/digest", json={"kind": "round", "scope": str(env.aug.id), "lang": "kk"}, headers=env.h)
    assert r.status_code == 503 and r.json()["detail"] == "ai_off"

    from app.core.config import settings
    from app.services import reading_ai

    monkeypatch.setattr(settings, "anthropic_api_key", "test")
    seen = {}

    class _Now:
        def __init__(self, target, args, daemon):
            seen["args"] = args

        def start(self):
            pass

    monkeypatch.setattr(reading_ai.threading, "Thread", _Now)
    r = c.post("/api/reading/digest", json={"kind": "round", "scope": str(env.aug.id), "lang": "kk"}, headers=env.h)
    assert r.status_code == 202, r.text
    _, kind, lang, payload = seen["args"]
    assert (kind, lang) == ("round", "kk")
    assert payload["round"]["goal_days"] == 21 and payload["previous_round"]["month"] == 7
    assert payload["books_finished_in_this_round"] == ["Book 0"]
    assert {i["key"] for i in payload["noticed_weak_spots"]} >= {"fade", "gaps"}
    assert c.post("/api/reading/digest", json={"kind": "round", "scope": "nope", "lang": "ru"}, headers=env.h).status_code == 400
