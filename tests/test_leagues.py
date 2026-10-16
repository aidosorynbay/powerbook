"""Reading leagues: the rules a reader's league moves by, circle after circle,
and the history behind them read from real rows (archive nicknames included)."""
from __future__ import annotations

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
from app.models.enums import ClaimStatus, Gender, RoundParticipantStatus, RoundStatus
from app.models.group import Group
from app.models.round import ReadingLog, Round, RoundParticipant
from app.models.user import User
from app.services import leagues
from app.services.leagues import LeagueState, days_for, level_of, step

T = 29  # September: 30 days, the last one for corrections


def run(*results, start=None):
    """Replay circles given as scored days out of 29 (None = not in the circle)."""
    st = start or LeagueState()
    levels = []
    for n in results:
        step(st, scored=n or 0, total=T, took_part=n is not None)
        levels.append(st.level)
    return st, levels


def test_thresholds_on_a_29_day_circle():
    assert [days_for(lv, T) for lv in (1, 2, 3, 4)] == [15, 21, 25, 28]
    assert [level_of(n, T) for n in (14, 15, 20, 21, 24, 25, 27, 28, 29)] == [0, 1, 1, 2, 2, 3, 3, 4, 4]


def test_up_at_once_but_diamond_only_from_the_third_circle():
    _, levels = run(29, 29, 29)
    assert levels == [3, 3, 4]


def test_first_weak_circle_only_warns_then_one_step_per_circle():
    st, levels = run(26, 26, 26, 15, 15, 15)
    assert levels == [3, 3, 3, 3, 2, 1]
    assert st.weak == 3


def test_a_good_circle_clears_the_warning():
    st, levels = run(26, 26, 15, 26, 15)
    assert levels == [3, 3, 3, 3, 3]
    assert st.weak == 1


def test_three_circles_without_reading_leave_the_leagues():
    _, levels = run(26, 26, 26, None, None, None)
    assert levels == [3, 3, 3, 3, 2, 0]


def test_coming_back_takes_the_first_circle():
    _, levels = run(26, None, None, None, 22)
    assert levels[-1] == 2


def test_ex_libris_is_three_diamonds_in_a_row_and_can_fall():
    _, levels = run(29, 29, 29, 29, 29, 29, 25, 25)
    # circles 1-2 are capped at gold; diamonds start at circle 3, ex libris after three of them
    assert levels == [3, 3, 4, 4, 5, 5, 5, 4]


@pytest.fixture()
def env():
    leagues.reset_cache()
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
    group = Group(name="PowerBook", slug="powerbook", owner_user_id=me.id)
    db.add(group)
    db.flush()

    def circle(year, month, who_days, status=RoundStatus.results_published):
        rnd = Round(group_id=group.id, year=year, month=month, status=status)
        db.add(rnd)
        db.flush()
        for user, n in who_days:
            db.add(RoundParticipant(round_id=rnd.id, user_id=user.id, status=RoundParticipantStatus.active))
            for i, d in enumerate(rnd.day_list):
                if i < n:
                    db.add(ReadingLog(round_id=rnd.id, user_id=user.id, date=d, minutes=40, score=1))
        return rnd

    # the archive: two strong circles under the old nickname, years ago
    circle(2021, 3, [(ghost, 31)])
    circle(2021, 4, [(ghost, 30)])
    # this year: a weak August, a full September, October still running
    circle(2026, 8, [(me, 11), (other, 30)])
    circle(2026, 9, [(me, 29), (other, 29)])
    octo = circle(2026, 10, [(me, 3), (other, 0)], status=RoundStatus.registration_open)
    db.add(UsernameClaim(claimant_user_id=me.id, ghost_user_id=ghost.id, status=ClaimStatus.approved))
    db.commit()

    app = create_app()

    def _db():
        yield db

    app.dependency_overrides[get_db] = _db
    client = TestClient(app)
    yield db, client, me, other, octo
    leagues.reset_cache()


def _auth(user):
    return {"Authorization": f"Bearer {create_access_token(subject=str(user.id))}"}


def test_a_veteran_after_a_long_break_gets_diamond_from_one_full_circle(env):
    db, client, me, other, octo = env
    r = client.get("/api/insights/league", headers=_auth(me))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["tier"] == "diamond"
    assert body["since_year"] == 2021
    assert body["based_on"]["scored"] == 29 and body["based_on"]["total"] == 29
    assert body["promoted_round_id"] is not None
    assert [h["tier"] for h in body["collection"]] == ["bronze", "silver", "gold", "diamond"]
    assert body["collection"][0]["year"] == 2021 and body["collection"][3]["year"] == 2026


def test_a_newcomer_with_a_full_circle_wears_gold(env, monkeypatch):
    from datetime import date

    monkeypatch.setattr(leagues, "_today", lambda: date(2026, 10, 1))
    db, client, me, other, octo = env
    body = client.get("/api/insights/league", headers=_auth(other)).json()
    # August 30 of 30 counts as 29 of 29 (gold: first circle), September again (gold: second circle)
    assert body["tier"] == "gold"
    assert body["diamond_open"] is True
    assert body["progress"]["next"]["tier"] == "diamond"


def test_the_board_carries_each_readers_league(env):
    db, client, me, other, octo = env
    rows = client.get(f"/api/rounds/{octo.id}/leaderboard", headers=_auth(me)).json()
    by_name = {r["display_name"]: r["league"] for r in rows}
    assert by_name == {"Madik": "diamond", "Aru": "gold"}
