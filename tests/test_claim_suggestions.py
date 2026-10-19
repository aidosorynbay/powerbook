"""Finding one's old nickname in the circles' archive: suggestions that see
Сайра and Saira as one name, a search in either script, a request that can
be taken back, and the founder linking a reader from the admin."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.admin_coverage import build
from app.core.security import create_access_token
from app.db.base import Base
from app.db.session import get_db
from app.main import create_app
from app.models.claim import UsernameClaim
from app.models.enums import ClaimStatus, Gender, RoundParticipantStatus, RoundStatus
from app.models.group import Group
from app.models.round import Round, RoundParticipant
from app.models.user import User
from app.services import claim_match
from app.services.claims import ClaimsService


@pytest.fixture()
def env():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    db = Session()
    claim_match.invalidate()

    opened = datetime(2026, 9, 1, tzinfo=timezone.utc)
    saira = User(username="saira_k", display_name="Сайра Кенже", password_hash="x", gender=Gender.female, created_at=opened)
    aidos = User(username="aidos", display_name="Айдос", password_hash="x", gender=Gender.male, telegram_id="aidos",
                 created_at=datetime(2026, 8, 10, tzinfo=timezone.utc))
    ghost_saira = User(username="Saira", display_name="Saira", password_hash="x", gender=Gender.female, is_claimable=True)
    ghost_bolat = User(username="Bolat", display_name="Bolat", password_hash="x", gender=Gender.male, is_claimable=True)
    ghost_dana = User(username="dana_reads", display_name="Dana", password_hash="x", gender=Gender.female, is_claimable=True)
    db.add_all([saira, aidos, ghost_saira, ghost_bolat, ghost_dana])
    db.flush()
    group = Group(name="PowerBook", slug="powerbook", owner_user_id=aidos.id)
    db.add(group)
    db.flush()

    def circle(year, month, *people):
        r = Round(group_id=group.id, year=year, month=month, status=RoundStatus.closed, end_day=None, registration_open_until_day=10)
        db.add(r)
        db.flush()
        for p in people:
            db.add(RoundParticipant(round_id=r.id, user_id=p.id, status=RoundParticipantStatus.active))
        return r

    circle(2023, 5, ghost_saira, ghost_bolat, aidos)  # aidos came with the import
    circle(2025, 11, ghost_dana)
    circle(2026, 9, saira, aidos)
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

    def h(u):
        return {"Authorization": f"Bearer {create_access_token(subject=str(u.id))}"}

    yield type("Env", (), dict(db=db, client=client, h=h, saira=saira, aidos=aidos, ghost_saira=ghost_saira,
                               ghost_bolat=ghost_bolat, ghost_dana=ghost_dana))
    claim_match.invalidate()


def test_names_in_either_script_are_one_name():
    a = claim_match.keys("saira_k", "Сайра Кенже")
    assert claim_match.score(a, claim_match.keys("Saira")) >= claim_match.THRESHOLD
    assert claim_match.score(a, claim_match.keys("Bolat")) < claim_match.THRESHOLD
    assert claim_match.score(claim_match.keys("@makooo"), claim_match.keys("makooo")) == 1.0


def test_suggestions_find_the_archive_name_and_say_whether_history_came_by_itself(env):
    out = env.client.get("/api/claims/suggestions", headers=env.h(env.saira)).json()
    assert out["has_archive"] is False
    assert [s["username"] for s in out["suggestions"]] == ["Saira"]
    assert out["suggestions"][0]["rounds"] == ["May 2023"]

    # Aidos's circles came with the import: nothing to ask him about.
    assert env.client.get("/api/claims/suggestions", headers=env.h(env.aidos)).json()["has_archive"] is True


def test_search_reads_cyrillic_as_latin(env):
    found = env.client.get("/api/claims/search", params={"q": "Сайра"}, headers=env.h(env.saira)).json()
    assert "Saira" in [c["username"] for c in found]
    # and the plain substring search still works
    found = env.client.get("/api/claims/search", params={"q": "bol"}, headers=env.h(env.saira)).json()
    assert [c["username"] for c in found] == ["Bolat"]


def test_a_waiting_request_can_be_taken_back_and_leaves_the_suggestions(env):
    c = env.client
    claim = c.post("/api/claims", json={"ghost_user_id": str(env.ghost_saira.id)}, headers=env.h(env.saira)).json()
    assert claim["status"] == "pending"
    # asked for already: no longer suggested
    assert c.get("/api/claims/suggestions", headers=env.h(env.saira)).json()["suggestions"] == []

    assert c.delete(f"/api/claims/{claim['id']}", headers=env.h(env.saira)).status_code == 200
    mine = c.get("/api/claims/mine", headers=env.h(env.saira)).json()
    assert [m["status"] for m in mine] == ["revoked"]
    # taken back: suggested again
    assert [s["username"] for s in c.get("/api/claims/suggestions", headers=env.h(env.saira)).json()["suggestions"]] == ["Saira"]


def test_the_founder_links_a_reader_and_the_coverage_counts_follow(env):
    before = build(env.db)["counts"]
    assert before["real"] == 2 and before["with_archive"] == 1 and before["neither"] == 1
    assert before["ghosts"] == 3 and before["ghosts_recent_free"] == 1  # dana read in 2025
    readers = build(env.db)["readers"]
    assert readers[0]["username"] == "saira_k" and readers[0]["matches"][0]["username"] == "Saira"

    ClaimsService(env.db).link_by_admin(user_id=env.saira.id, ghost_user_id=env.ghost_saira.id, admin_id=env.aidos.id)
    claim = env.db.query(UsernameClaim).filter_by(claimant_user_id=env.saira.id).one()
    assert claim.status == ClaimStatus.approved and claim.reviewed_by_user_id == env.aidos.id

    after = build(env.db)["counts"]
    assert after["with_approved"] == 1 and after["neither"] == 0 and after["ghosts_granted"] == 1




def test_a_nickname_changed_mid_month_waits_for_the_founder_not_turned_away(env):
    # A reader renamed mid-month is in that circle under both nicknames; asking for the second one used to fail
    # with «one person per circle» (2026-10-19). Now it waits for the founder, who sees the shared circle.
    renamed = User(username="saira_new", display_name="Saira new", password_hash="x", gender=Gender.female, is_claimable=True)
    env.db.add(renamed)
    env.db.flush()
    may = env.db.query(Round).filter_by(year=2023, month=5).one()
    env.db.add(RoundParticipant(round_id=may.id, user_id=renamed.id, status=RoundParticipantStatus.active))
    env.db.commit()
    ClaimsService(env.db).link_by_admin(user_id=env.saira.id, ghost_user_id=env.ghost_saira.id, admin_id=env.aidos.id)

    r = env.client.post("/api/claims", json={"ghost_user_id": str(renamed.id)}, headers=env.h(env.saira))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "pending"
    pending = build(env.db)["pending"]
    assert [(p["ghost"], p["clash"]) for p in pending] == [("saira_new", "May 2023")]

    # the founder approves it, or links it straight from the admin
    ClaimsService(env.db).link_by_admin(user_id=env.saira.id, ghost_user_id=renamed.id, admin_id=env.aidos.id)
    env.db.expire_all()
    claim = env.db.query(UsernameClaim).filter_by(ghost_user_id=renamed.id).one()
    assert claim.status == ClaimStatus.approved


@pytest.fixture()
def telegram(monkeypatch):
    """Telegram itself replaced by a list of what the bot would have said."""
    from app.core.config import settings
    from app.services import admin_ping

    calls = []
    monkeypatch.setattr(settings, "telegram_bot_token", "t")
    monkeypatch.setattr(settings, "telegram_admin_chat_ids", "111, 222")
    monkeypatch.setattr(admin_ping, "_later", lambda method, payload: calls.append((method, payload)))
    return calls


def test_the_founder_hears_in_telegram_when_a_reader_asks(env, telegram):
    env.client.post("/api/claims", json={"ghost_user_id": str(env.ghost_saira.id)}, headers=env.h(env.saira))
    assert [(m, p["chat_id"]) for m, p in telegram] == [("sendMessage", "111"), ("sendMessage", "222")]
    text = telegram[0][1]["text"]
    assert "Сайра Кенже (@saira_k) говорит, что это она: «Saira» (@Saira)" in text
    buttons = telegram[0][1]["reply_markup"]["inline_keyboard"][0]
    assert [b["text"] for b in buttons] == ["✅ Одобрить", "❌ Отказать"]

    # The founder linking someone themselves is not news to them.
    telegram.clear()
    ClaimsService(env.db).link_by_admin(user_id=env.saira.id, ghost_user_id=env.ghost_bolat.id, admin_id=env.aidos.id)
    assert telegram == []


def _press(env, data, *, sender=111, secret=None):
    from app.services import admin_ping

    update = {"callback_query": {"id": "q", "data": data, "from": {"id": sender},
                                 "message": {"message_id": 5, "chat": {"id": sender}, "text": "🙋 Заявка"}}}
    return env.client.post("/api/telegram/webhook", json=update,
                           headers={"X-Telegram-Bot-Api-Secret-Token": secret or admin_ping.webhook_secret()})


def test_the_founder_approves_or_refuses_from_telegram(env, telegram):
    c = env.client
    asked = c.post("/api/claims", json={"ghost_user_id": str(env.ghost_saira.id)}, headers=env.h(env.saira)).json()
    other = c.post("/api/claims", json={"ghost_user_id": str(env.ghost_dana.id)}, headers=env.h(env.saira)).json()
    telegram.clear()

    # Not Telegram (no secret), and not the founder: nothing changes.
    assert _press(env, f"claim:a:{asked['id']}", secret="wrong").status_code == 403
    _press(env, f"claim:a:{asked['id']}", sender=999)
    env.db.expire_all()
    assert env.db.get(UsernameClaim, __import__("uuid").UUID(asked["id"])).status == ClaimStatus.pending

    telegram.clear()
    assert _press(env, f"claim:a:{asked['id']}").status_code == 200
    _press(env, f"claim:r:{other['id']}")
    env.db.expire_all()
    mine = {m["ghost_username"]: m["status"] for m in c.get("/api/claims/mine", headers=env.h(env.saira)).json()}
    assert mine == {"Saira": "approved", "dana_reads": "revoked"}
    edits = [p["text"] for m, p in telegram if m == "editMessageText"]
    assert edits == ["🙋 Заявка\n\n✅ Одобрено", "🙋 Заявка\n\n❌ Отказано"]

    # A second press says it is settled and changes nothing.
    telegram.clear()
    _press(env, f"claim:r:{asked['id']}")
    assert [p["text"] for m, p in telegram if m == "answerCallbackQuery"] == ["Уже одобрено"]
