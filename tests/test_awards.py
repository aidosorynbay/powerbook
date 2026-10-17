"""Awards: what a reader's history earns, on which day, and how the showcase
reads it — archive nicknames, a circle's neutral last day and the secrets."""
from __future__ import annotations

import uuid
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
from app.models.claim import UsernameClaim
from app.models.clan_war import ClanWar, ClanWarMember
from app.models.enums import ClaimStatus, Gender, ResultGroup, RoundParticipantStatus, RoundStatus
from app.models.group import Group
from app.models.reading_room import ReadingRoomSession
from app.models.round import ReadingLog, ReadingLogBook, Round, RoundParticipant, RoundResult
from app.models.user import User
from app.services import awards, genres
from app.services.awards import Person, evaluate


def _round(year, month):
    return Round(id=uuid.uuid4(), year=year, month=month, start_day=1, status=RoundStatus.results_published)


def test_days_are_dated_on_the_day_the_number_was_reached():
    rnd = _round(2026, 9)
    p = Person(counted=set(rnd.day_list[:29]))
    res = evaluate(p, [rnd], frozenset({rnd.last_day_date}))
    assert res.earned["days_1"] == date(2026, 9, 1)
    assert "days_30" not in res.earned  # 29 days: the 30th is still ahead
    assert res.values["days"] == 29


def test_minutes_are_dated_on_the_day_the_total_was_reached():
    p = Person(minutes={date(2026, 9, 1): 600, date(2026, 9, 2): 500, date(2026, 9, 3): 4000})
    res = evaluate(p, [], frozenset())
    assert res.earned["minutes_1000"] == date(2026, 9, 2)
    assert res.earned["minutes_5000"] == date(2026, 9, 3)
    assert "minutes_10000" not in res.earned
    assert res.values["minutes"] == 5100


def test_rarity_is_five_steps_from_the_share_of_readers():
    assert [awards.rarity(h, 100) for h in (80, 30, 12, 5, 1)] == [1, 2, 3, 4, 5]
    assert awards.rarity(1, 0) == 5


def test_a_genre_pin_comes_at_600_minutes_and_variety_counts_genres_with_120():
    p = Person(genres={
        "business": {date(2026, 9, 1): 400, date(2026, 9, 2): 250},
        "kazakh": {date(2026, 9, 3): 119},
        "poetry": {date(2026, 9, 4): 130},
        "health": {date(2026, 9, 5): 200},  # no pin of its own, still a genre
    })
    res = evaluate(p, [], frozenset())
    assert res.earned["genre_business"] == date(2026, 9, 2)
    assert "genre_kazakh" not in res.earned and "genre_poetry" not in res.earned
    assert res.values["variety"] == 3  # business, poetry, health; kazakh is 1 minute short
    assert res.earned["variety_3"] == date(2026, 9, 5)
    assert "variety_6" not in res.earned
    assert res.genre_minutes["business"] == 650


def test_a_streak_runs_across_the_neutral_last_day_and_is_dated_when_reached():
    aug, sep = _round(2026, 8), _round(2026, 9)
    read = [d for d in aug.day_list + sep.day_list if d not in (aug.last_day_date, sep.last_day_date)]
    p = Person(counted=set(read))
    res = evaluate(p, [aug, sep], frozenset({aug.last_day_date, sep.last_day_date}))
    assert res.values["streak"] == 59
    assert res.earned["streak_30"] == date(2026, 8, 30)
    assert "streak_100" not in res.earned


def test_a_clean_circle_needs_every_day_but_the_last():
    sep, octo = _round(2026, 9), _round(2026, 10)
    full_sep = {d for d in sep.day_list if d != sep.last_day_date}
    p = Person(counted=full_sep | set(octo.day_list[:29]), circles={sep.id, octo.id})
    res = evaluate(p, [sep, octo], frozenset({sep.last_day_date, octo.last_day_date}))
    assert res.values["clean"] == 1 and res.earned["clean_1"] == date(2026, 9, 30)
    assert "clean_3" not in res.earned


def test_the_treasury_counts_those_whose_minutes_were_in_it():
    early = Person(minutes={date(2021, 4, 1): 40})
    late = Person(minutes={date(2026, 9, 1): 40})
    treasury = (5_500_000, {1: date(2022, 1, 5), 2: date(2023, 3, 1), 3: date(2024, 6, 1), 5: date(2026, 9, 10)})
    got_early = evaluate(early, [], frozenset(), treasury).earned
    got_late = evaluate(late, [], frozenset(), treasury).earned
    assert [k for k in got_early if k.startswith("together")] == ["together_1", "together_2", "together_3", "together_5"]
    assert [k for k in got_late if k.startswith("together")] == ["together_5"]
    assert got_late["together_5"] == date(2026, 9, 10)


@pytest.fixture()
def env(monkeypatch):
    awards.reset_cache()
    monkeypatch.setattr(awards, "_today", lambda: date(2026, 10, 20))
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    db = Session()
    me = User(username="madik", display_name="Madik", password_hash="x", gender=Gender.male)
    ghost = User(username="old_madik", display_name="old_madik", password_hash="x", gender=Gender.male, is_claimable=True)
    other = User(username="aru", display_name="Aru", password_hash="x", gender=Gender.female)
    db.add_all([me, ghost, other])
    db.flush()
    friend = User(username="dana", display_name="Dana", password_hash="x", gender=Gender.female, invited_by=me.id)
    db.add(friend)
    db.flush()
    group = Group(name="PowerBook", slug="powerbook", owner_user_id=me.id)
    db.add(group)
    db.flush()

    def circle(year, month, who_days, status=RoundStatus.results_published, winners=()):
        rnd = Round(group_id=group.id, year=year, month=month, status=status)
        db.add(rnd)
        db.flush()
        for user, n in who_days:
            db.add(RoundParticipant(round_id=rnd.id, user_id=user.id, status=RoundParticipantStatus.active))
            for i, d in enumerate(rnd.day_list):
                if i < n and d != rnd.last_day_date:
                    db.add(ReadingLog(round_id=rnd.id, user_id=user.id, date=d, minutes=45, score=1))
        for rank, user in enumerate(winners, start=1):
            db.add(RoundResult(round_id=rnd.id, user_id=user.id, total_score=0, rank=rank, group=ResultGroup.winner))
        return rnd

    # the archive under the old nickname: April 2021 in full (23 April among its days), then a long break
    circle(2021, 4, [(ghost, 30)], winners=[ghost])
    circle(2021, 5, [(ghost, 10)])
    # back after more than a year: a full August and September, October running
    circle(2026, 8, [(me, 31), (other, 12)], winners=[me])
    circle(2026, 9, [(me, 30), (other, 30), (friend, 3)], winners=[me, other])
    octo = circle(2026, 10, [(me, 19)], status=RoundStatus.registration_open)
    db.add(UsernameClaim(claimant_user_id=me.id, ghost_user_id=ghost.id, status=ClaimStatus.approved))
    # five evenings in the reading room after 23:00 (Astana), credited
    for i in range(5):
        at = datetime(2026, 9, 10 + i, 18, 30, tzinfo=timezone.utc)  # 23:30 in Astana
        db.add(ReadingRoomSession(user_id=me.id, hall="main", seat=1, book_title="Бесы", created_at=at, credited_minutes=40))
    war = ClanWar(start_date=date(2026, 10, 18), end_date=date(2026, 10, 31), status="live")
    db.add(war)
    db.flush()
    db.add(ClanWarMember(war_id=war.id, user_id=me.id, team=1))
    db.commit()

    app = create_app()

    def _db():
        yield db

    app.dependency_overrides[get_db] = _db
    yield db, TestClient(app), me, other, octo
    awards.reset_cache()


def _auth(user):
    return {"Authorization": f"Bearer {create_access_token(subject=str(user.id))}"}


def test_the_showcase_folds_the_archive_and_dates_every_award(env):
    db, client, me, other, octo = env
    r = client.get("/api/insights/awards", headers=_auth(me))
    assert r.status_code == 200, r.text
    body = r.json()
    got = {a["key"]: a["on"] for a in body["earned"]}
    # 29 + 10 archive days + 30 + 29 + 19 this year = 117 days of 30+ minutes
    assert body["tracks"][0] == {"track": "days", "value": 117, "now": 117, "next": 200}
    assert got["days_1"] == "2021-04-01"
    assert got["days_100"] == "2026-10-02"
    assert body["title"] == "days_100"
    # April 2021 in full, then August and September: one run across the neutral 31 August
    assert got["clean_1"] == "2021-04-30" and got["clean_3"] == "2026-09-30"
    # 1–29 April 2021, the neutral 30 April, 1 May: thirty in a row; August to mid-October is 78, not yet 100
    assert got["streak_30"] == "2021-05-01" and "streak_100" not in got
    # the secrets: 23 April 2021, the first year, the comeback, the war
    assert got["book_day"] == "2021-04-23"
    assert got["first_year"] == "2021-04-01"
    assert got["comeback"] == "2026-08-01"
    assert "war_1" not in got  # the war (18–31 October) is still on
    assert "new_year" not in got
    assert all(a["new"] for a in body["earned"]) and body["first_time"] is True
    # rarity counts people, the claimed nickname inside its claimant
    holders = {a["key"]: a["holders"] for a in body["earned"]}
    assert holders["clean_1"] == 2 and holders["book_day"] == 1


def test_seen_awards_are_not_new_any_more(env):
    db, client, me, other, octo = env
    keys = [a["key"] for a in client.get("/api/insights/awards", headers=_auth(me)).json()["earned"]]
    r = client.post("/api/insights/awards/seen", json={"keys": keys[:3] + ["nonsense"]}, headers=_auth(me))
    assert r.status_code == 200 and r.json() == {"added": 3}
    body = client.get("/api/insights/awards", headers=_auth(me)).json()
    assert [a["key"] for a in body["earned"] if not a["new"]] == keys[:3]
    assert body["first_time"] is False


def test_a_new_day_shows_at_once(env):
    db, client, me, other, octo = env
    before = client.get("/api/insights/awards", headers=_auth(other)).json()
    assert before["tracks"][0]["value"] == 41
    d = octo.day_list[0]
    db.add(RoundParticipant(round_id=octo.id, user_id=other.id, status=RoundParticipantStatus.active))
    db.add(ReadingLog(round_id=octo.id, user_id=other.id, date=d, minutes=30, score=1))
    db.commit()
    after = client.get("/api/insights/awards", headers=_auth(other)).json()
    assert after["tracks"][0]["value"] == 42


def test_the_war_award_comes_after_the_war_and_is_dated_its_last_day(env, monkeypatch):
    db, client, me, other, octo = env
    for today in (date(2026, 10, 17), date(2026, 10, 31)):  # before it, and on its last day
        monkeypatch.setattr(awards, "_today", lambda today=today: today)
        awards.reset_cache()
        got = {a["key"] for a in client.get("/api/insights/awards", headers=_auth(me)).json()["earned"]}
        assert "war_1" not in got
    monkeypatch.setattr(awards, "_today", lambda: date(2026, 11, 1))
    awards.reset_cache()
    mine = {a["key"]: a["on"] for a in client.get("/api/insights/awards", headers=_auth(me)).json()["earned"]}
    assert mine["war_1"] == "2026-10-31"
    got = {a["key"] for a in client.get("/api/insights/awards", headers=_auth(other)).json()["earned"]}
    assert "war_1" not in got  # signed up for nothing


def test_an_award_once_given_stays(env):
    db, client, me, other, octo = env
    got = {a["key"] for a in client.get("/api/insights/awards", headers=_auth(other)).json()["earned"]}
    assert "clean_1" in got  # a full September
    # September's days are taken away again (a correction, a nickname unlinked by mistake)
    for log in db.query(ReadingLog).filter(ReadingLog.user_id == other.id).all():
        db.delete(log)
    db.commit()
    body = client.get("/api/insights/awards", headers=_auth(other)).json()
    assert "clean_1" in {a["key"] for a in body["earned"]}
    assert body["tracks"][0]["value"] == 0


def test_the_treasury_marks_go_to_whoever_was_reading_then(env, monkeypatch):
    db, client, me, other, octo = env
    monkeypatch.setattr(awards, "MILLION", 1000)  # marks at 1 000, 2 000, 3 000, 5 000 and 10 000 minutes
    awards.reset_cache()
    mine = {a["key"]: a["on"] for a in client.get("/api/insights/awards", headers=_auth(me)).json()["earned"]}
    theirs = {a["key"] for a in client.get("/api/insights/awards", headers=_auth(other)).json()["earned"]}
    # 45 minutes a day: the archive passed 1 000 on 23 April 2021, 2 000 only in August 2026
    assert mine["together_1"] == "2021-04-23"
    assert {"together_1", "together_2", "together_3", "together_5"} <= set(mine) and "together_10" not in mine
    assert "together_1" not in theirs and {"together_2", "together_3", "together_5"} <= theirs


def test_awards_can_be_hidden_and_shown_again(env):
    db, client, me, other, octo = env
    assert client.get("/api/insights/awards", headers=_auth(me)).json()["hidden"] is False
    assert client.post("/api/insights/awards/hidden", json={"hidden": True}, headers=_auth(me)).json() == {"hidden": True}
    body = client.get("/api/insights/awards", headers=_auth(me)).json()
    assert body["hidden"] is True and body["earned"]  # hidden, not taken away
    client.post("/api/insights/awards/hidden", json={"hidden": False}, headers=_auth(me))
    assert client.get("/api/insights/awards", headers=_auth(me)).json()["hidden"] is False


def test_an_admin_can_look_without_writing_anything(env):
    from app.models.award import ReaderAward
    from app.models.enums import SystemRole

    db, client, me, other, octo = env
    assert client.get(f"/api/insights/awards/of/{other.id}", headers=_auth(me)).status_code == 403
    me.system_role = SystemRole.admin
    db.commit()
    body = client.get(f"/api/insights/awards/of/{other.id}", headers=_auth(me)).json()
    assert "clean_1" in {a["key"] for a in body["earned"]} and not any(a["new"] for a in body["earned"])
    assert db.query(ReaderAward).filter(ReaderAward.user_id == other.id).count() == 0


def test_genre_minutes_come_from_the_books_and_make_a_pin(env, monkeypatch):
    db, client, me, other, octo = env
    monkeypatch.setattr(genres, "topic_lookup", lambda _db: {"Теория игр": "business", "Бесы": "classics"}.get)
    awards.reset_cache()
    # 30 September days of 45 minutes on a business book (1 350 minutes), 3 on a classic (135)
    logs = list(db.query(ReadingLog).filter(ReadingLog.user_id == me.id, ReadingLog.date >= date(2026, 9, 1), ReadingLog.date <= date(2026, 9, 30)))
    logs.sort(key=lambda r: r.date)
    for i, log in enumerate(logs):
        title = "Бесы" if i < 3 else "Теория игр"
        db.add(ReadingLogBook(reading_log_id=log.id, user_id=me.id, title=title, title_norm=title.casefold(), minutes=log.minutes, finished=False, position=0))
    db.commit()
    body = client.get("/api/insights/awards", headers=_auth(me)).json()
    got = {a["key"]: a["on"] for a in body["earned"]}
    assert got["genre_business"] == "2026-09-17"  # 3 days went to the classic, then the 14th day of 45 passes 600
    assert "genre_classics" not in got
    assert body["genre_minutes"]["business"] > 1000 and body["genre_minutes"]["classics"] == 135
    assert "variety_3" not in got  # two genres so far


def test_the_pin_by_the_avatar_is_automatic_until_the_reader_picks_one_or_none(env):
    db, client, me, other, octo = env
    awards.reset_cache()
    body = client.get("/api/insights/awards", headers=_auth(me)).json()
    held = {a["key"] for a in body["earned"]}
    assert body["featured_mode"] == "auto" and body["featured"] == body["featured_auto"]
    assert body["featured"] in held and not awards.BY_KEY[body["featured"]].secret  # secrets never picked by themselves
    worn = client.get("/api/insights/awards/worn", headers=_auth(other)).json()
    assert worn[str(me.id)] == body["featured"]  # everyone sees the same pin
    assert client.post("/api/insights/awards/feature", json={"key": "days_30"}, headers=_auth(me)).status_code == 200
    body = client.get("/api/insights/awards", headers=_auth(me)).json()
    assert body["featured"] == "days_30" and body["featured_mode"] == "chosen"
    assert awards.worn_by(db, me.id) == "days_30"
    assert client.post("/api/insights/awards/feature", json={"key": "days_1000"}, headers=_auth(me)).status_code == 400
    client.post("/api/insights/awards/feature", json={"key": "none"}, headers=_auth(me))
    body = client.get("/api/insights/awards", headers=_auth(me)).json()
    assert body["featured"] is None and body["featured_mode"] == "none"
    assert str(me.id) not in client.get("/api/insights/awards/worn", headers=_auth(other)).json()  # never sent
    client.post("/api/insights/awards/feature", json={"key": None}, headers=_auth(me))
    assert client.get("/api/insights/awards", headers=_auth(me)).json()["featured_mode"] == "auto"
    client.post("/api/insights/awards/hidden", json={"hidden": True}, headers=_auth(me))
    assert awards.worn_by(db, me.id) is None  # hidden awards stay hidden everywhere


def test_the_automatic_pin_is_the_rarest_or_the_newest_and_never_a_secret(monkeypatch):
    on = {"days_1": date(2021, 4, 1), "first_year": date(2021, 4, 1), "streak_30": date(2021, 5, 1), "days_30": date(2026, 9, 1)}
    holders = {"days_1": 50, "first_year": 1, "streak_30": 4, "days_30": 30}
    assert awards.auto_pin(on, holders) == "streak_30"
    monkeypatch.setattr(awards, "AUTO_PIN", "newest")
    assert awards.auto_pin(on, holders) == "days_30"
