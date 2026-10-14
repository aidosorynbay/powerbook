"""A returning reader whose old Telegram nickname is in the circles' archive:
signing up with it goes through, the archive is offered on the next step,
and Telegram's own login grants it at once (2026-10-14, @azirgejalgyz)."""
from __future__ import annotations

import hashlib
import hmac
import time
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.core.config import settings
from app.core.security import verify_password
from app.db.base import Base
from app.db.session import get_db
from app.main import create_app
from app.models.claim import UsernameClaim
from app.models.enums import ClaimStatus, Gender, RoundParticipantStatus, RoundStatus
from app.models.group import Group
from app.models.round import Round, RoundParticipant
from app.models.user import User
from app.services import admin_ping, claim_match

BOT_TOKEN = "123:test-token"


def signed(**fields):
    """Login-widget data as Telegram signs it."""
    data = {"auth_date": int(time.time()), **fields}
    check = "\n".join(f"{k}={v}" for k, v in sorted(data.items()) if v is not None)
    secret = hashlib.sha256(BOT_TOKEN.encode()).digest()
    data["hash"] = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    return data


@pytest.fixture()
def env(monkeypatch):
    monkeypatch.setattr(settings, "telegram_bot_token", BOT_TOKEN)
    sent: list[tuple] = []
    monkeypatch.setattr(admin_ping, "_later", lambda method, payload: sent.append((method, payload)))
    monkeypatch.setattr(admin_ping, "chat_ids", lambda: ["1"])
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    db = Session()
    claim_match.invalidate()

    owner = User(username="founder", display_name="Founder", password_hash="x", gender=Gender.male, telegram_id="founder",
                 created_at=datetime(2026, 8, 1, tzinfo=timezone.utc))
    # As the migration leaves it: the old nickname in archive_nick, not telegram_id.
    ghost = User(username="azirgejalgyz", display_name="azirgejalgyz", password_hash="x", gender=Gender.male,
                 is_claimable=True, archive_nick="azirgejalgyz")
    lone = User(username="lone_reader", display_name="Lone", password_hash="x", gender=Gender.female,
                is_claimable=True, archive_nick="Lone_Reader")
    db.add_all([owner, ghost, lone])
    db.flush()
    group = Group(name="PowerBook", slug="powerbook", owner_user_id=owner.id)
    db.add(group)
    db.flush()
    r = Round(group_id=group.id, year=2023, month=5, status=RoundStatus.closed, end_day=None, registration_open_until_day=10)
    db.add(r)
    db.flush()
    db.add_all([
        RoundParticipant(round_id=r.id, user_id=ghost.id, status=RoundParticipantStatus.active),
        RoundParticipant(round_id=r.id, user_id=lone.id, status=RoundParticipantStatus.active),
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
    yield TestClient(app), Session, ghost.id, lone.id, sent
    db.close()


def register(client, **over):
    body = {"username": "adeque", "password": "secret1", "display_name": "Adilbek", "gender": "male",
            "telegram_id": "@azirgejalgyz", **over}
    return client.post("/api/auth/register", json=body)


def test_signing_up_with_the_archives_telegram_goes_through(env):
    client, Session, ghost_id, _, sent = env
    res = register(client)
    assert res.status_code == 200, res.text
    with Session() as s:
        me = s.execute(select(User).where(User.username == "adeque")).scalar_one()
        assert me.telegram_id == "azirgejalgyz"
        ghost = s.get(User, ghost_id)
        assert ghost.is_claimable and ghost.telegram_id is None

    # The next step offers the archive as theirs, first.
    token = res.json()["access_token"]
    hints = client.get("/api/claims/suggestions", headers={"Authorization": f"Bearer {token}"}).json()
    assert hints["suggestions"][0]["username"] == "azirgejalgyz"


def test_a_real_accounts_telegram_still_refuses(env):
    client, *_ = env
    assert register(client).status_code == 200
    again = register(client, username="someone_else")
    assert again.status_code == 409
    assert again.json()["detail"] == "Telegram ID already linked to another account"


def test_an_archive_username_is_told_apart(env):
    client, *_ = env
    res = register(client, username="azirgejalgyz", telegram_id="other_tg")
    assert res.status_code == 409
    assert res.json()["detail"] == "Username belongs to the archive"


def test_telegram_login_grants_the_archive_at_once(env):
    client, Session, ghost_id, _, sent = env
    token = register(client).json()["access_token"]
    auth = {"Authorization": f"Bearer {token}"}

    res = client.post("/api/claims/telegram", json=signed(id=555, username="AzirgeJalgyz"), headers=auth)
    assert res.status_code == 200, res.text
    assert [c["status"] for c in res.json()] == ["approved"]
    with Session() as s:
        claim = s.execute(select(UsernameClaim).where(UsernameClaim.ghost_user_id == ghost_id)).scalar_one()
        assert claim.status == ClaimStatus.approved and claim.note == "telegram verified"
    # The founder hears of it, with nothing to press.
    assert any("Через Telegram" in p["text"] and "reply_markup" not in p for _m, p in sent)


def test_a_forged_telegram_login_grants_nothing(env):
    client, *_ = env
    token = register(client).json()["access_token"]
    data = signed(id=555, username="azirgejalgyz")
    data["hash"] = "0" * 64
    res = client.post("/api/claims/telegram", json=data, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 400


def test_a_waiting_request_is_settled_by_telegram(env):
    client, Session, ghost_id, _, sent = env
    token = register(client).json()["access_token"]
    auth = {"Authorization": f"Bearer {token}"}
    assert client.post("/api/claims", json={"ghost_user_id": str(ghost_id)}, headers=auth).json()["status"] == "pending"

    res = client.post("/api/claims/telegram", json=signed(id=555, username="azirgejalgyz"), headers=auth)
    assert [c["status"] for c in res.json()] == ["approved"]
    with Session() as s:
        assert len(s.execute(select(UsernameClaim)).scalars().all()) == 1


def test_password_reset_through_telegram_opens_a_never_registered_archive(env):
    client, Session, _, lone_id, _sent = env
    res = client.post("/api/auth/reset-password", json={**signed(id=777, username="lone_reader"), "new_password": "newpass1"})
    assert res.status_code == 200, res.text
    with Session() as s:
        lone = s.get(User, lone_id)
        assert lone.telegram_id == "lone_reader"
        assert verify_password("newpass1", lone.password_hash)
    login = client.post("/api/auth/login", json={"login": "@lone_reader", "password": "newpass1"})
    assert login.status_code == 200
    with Session() as s:
        assert s.get(User, lone_id).is_claimable is False


def test_the_old_nickname_still_shows_beside_the_name(env):
    _, Session, ghost_id, _, _sent = env
    with Session() as s:
        ghost = s.get(User, ghost_id)
        assert ghost.telegram_handle == "azirgejalgyz"
        assert s.execute(select(User.telegram_handle).where(User.id == ghost_id)).scalar_one() == "azirgejalgyz"
