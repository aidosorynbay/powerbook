"""The window after a saved day: a reader tells what they think of PowerBook
and may send a photo of how they read. The answer lands in /admin, the
founder hears of it in Telegram, and a photo is shown only with the
reader's own tick."""
from __future__ import annotations

import base64
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.admin as admin_module
import app.models  # noqa: F401
from app.core.config import settings
from app.core.security import create_access_token, hash_password
from app.db.base import Base
from app.db.session import get_db
from app.main import create_app
from app.models.enums import Gender, RoundStatus, SystemRole
from app.models.group import Group
from app.models.reader_feedback import ReaderFeedback
from app.models.round import Round
from app.models.user import User
from app.services import admin_ping

JPEG_BYTES = b"\xff\xd8\xff\xe0" + b"0" * 200 + b"\xff\xd9"
JPEG = "data:image/jpeg;base64," + base64.b64encode(JPEG_BYTES).decode()


@pytest.fixture()
def env(monkeypatch):
    monkeypatch.setattr(settings, "telegram_bot_token", "123:test-token")
    monkeypatch.setattr(admin_ping, "chat_ids", lambda: ["1"])
    # what would go to Telegram, in the order it would arrive
    sent: list[tuple] = []
    monkeypatch.setattr(admin_ping, "_in_background", lambda fn, *args: fn(*args))
    monkeypatch.setattr(admin_ping, "_call", lambda method, payload: sent.append((method, payload)))
    monkeypatch.setattr(admin_ping, "_send_photo", lambda chat_id, data, media_type, caption: sent.append(("sendPhoto", data, media_type, caption)))

    # As the live database has it since n4p5q6r7s8t9: deleting an account clears gender.
    monkeypatch.setattr(User.__table__.c.gender, "nullable", True)
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    db = Session()
    reader = User(username="aigerim", display_name="Айгерим", password_hash="x", gender=Gender.female, telegram_id="aigerim_kz")
    founder = User(username="founder", display_name="Founder", password_hash=hash_password("secret"), gender=Gender.male,
                   system_role=SystemRole.admin)
    db.add_all([reader, founder])
    db.flush()
    group = Group(name="PowerBook", slug="powerbook", owner_user_id=founder.id)
    db.add(group)
    db.flush()
    october = Round(group_id=group.id, year=2026, month=10, status=RoundStatus.locked, registration_open_until_day=10)
    db.add(october)
    db.commit()

    # /admin opens its own sessions; point them at this database
    monkeypatch.setattr(admin_module, "get_session_factory", lambda: Session)
    monkeypatch.setattr(admin_module, "get_engine", lambda: engine)
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

    yield type("Env", (), dict(db=db, client=client, h=h, reader=reader, founder=founder, round=october, sent=sent))


def rows(env):
    env.db.expire_all()
    return env.db.execute(select(ReaderFeedback).order_by(ReaderFeedback.created_at)).scalars().all()


def test_a_reader_answers_with_a_photo_and_the_founder_hears(env):
    r = env.client.post("/api/feedback", json={
        "mood": "love", "text": "  Календарь держит меня в тонусе  ", "photo": JPEG, "photo_consent": True,
        "round_id": str(env.round.id), "source": "after_save", "locale": "ru",
    }, headers=env.h(env.reader))
    assert r.status_code == 200, r.text

    [row] = rows(env)
    assert row.user_id == env.reader.id and row.round_id == env.round.id
    assert row.mood == "love" and row.text == "Календарь держит меня в тонусе"
    assert row.photo == JPEG and row.photo_consent is True
    assert row.source == "after_save" and row.locale == "ru"

    # the words first, then the photo under them
    (method, message), photo = env.sent
    assert method == "sendMessage"
    text = message["text"]
    assert "Айгерим (@aigerim, tg @aigerim_kz)" in text and "😍 Нравится" in text
    assert "«Календарь держит меня в тонусе»" in text and "можно показывать" in text
    assert "/admin/reader-feedback/list" in text
    assert photo[0] == "sendPhoto" and photo[1] == JPEG_BYTES and photo[2] == "image/jpeg" and "✅" in photo[3]


def test_a_photo_without_the_tick_is_for_the_team_only(env):
    r = env.client.post("/api/feedback", json={"photo": JPEG}, headers=env.h(env.reader))
    assert r.status_code == 200, r.text
    [row] = rows(env)
    assert row.photo_consent is False and row.mood is None and row.text is None
    assert "только для нас" in env.sent[0][1]["text"]


def test_a_mood_alone_is_an_answer_and_the_tick_needs_a_photo(env):
    r = env.client.post("/api/feedback", json={"mood": "improve", "photo_consent": True}, headers=env.h(env.reader))
    assert r.status_code == 200, r.text
    [row] = rows(env)
    assert row.mood == "improve" and row.photo is None and row.photo_consent is False
    assert [m for m, *_ in env.sent] == ["sendMessage"]


def test_nothing_to_send_bad_photos_and_strangers_are_refused(env):
    c = env.client
    assert c.post("/api/feedback", json={"text": "   "}, headers=env.h(env.reader)).json()["detail"] == "empty_feedback"
    assert c.post("/api/feedback", json={"photo": "data:text/html;base64,PGI+"}, headers=env.h(env.reader)).json()["detail"] == "bad_photo"
    assert c.post("/api/feedback", json={"mood": "meh"}, headers=env.h(env.reader)).status_code == 422
    huge = "data:image/jpeg;base64," + base64.b64encode(b"0" * 1_600_000).decode()
    assert c.post("/api/feedback", json={"photo": huge}, headers=env.h(env.reader)).json()["detail"] == "photo_too_large"
    assert c.post("/api/feedback", json={"mood": "love"}).status_code in (401, 403)
    assert rows(env) == [] and env.sent == []


def test_a_stale_circle_does_not_fail_the_answer(env):
    r = env.client.post("/api/feedback", json={"mood": "ok", "round_id": str(uuid.uuid4())}, headers=env.h(env.reader))
    assert r.status_code == 200, r.text
    assert rows(env)[0].round_id is None


def test_a_stuck_button_cannot_flood_the_founder(env):
    for _ in range(5):
        assert env.client.post("/api/feedback", json={"mood": "love"}, headers=env.h(env.reader)).status_code == 200
    r = env.client.post("/api/feedback", json={"mood": "love"}, headers=env.h(env.reader))
    assert r.status_code == 429 and r.json()["detail"] == "too_many"
    assert len(rows(env)) == 5


def test_deleting_the_account_deletes_the_answers_and_photos(env):
    env.reader.password_hash = hash_password("pw")
    env.db.commit()
    env.client.post("/api/feedback", json={"photo": JPEG, "photo_consent": True}, headers=env.h(env.reader))
    assert len(rows(env)) == 1
    r = env.client.post("/api/auth/delete-account", json={"password": "pw"}, headers=env.h(env.reader))
    assert r.status_code == 204, r.text
    assert rows(env) == []


def test_the_photo_opens_in_admin_only_after_signing_in(env):
    env.client.post("/api/feedback", json={"photo": JPEG}, headers=env.h(env.reader))
    [row] = rows(env)
    c = env.client
    r = c.get(f"/admin/feedback-photo/{row.id}", follow_redirects=False)
    assert r.status_code in (302, 303) and "/admin/login" in r.headers["location"]

    r = c.post("/admin/login", data={"username": "founder", "password": "secret"}, follow_redirects=False)
    assert r.status_code in (302, 303)
    r = c.get(f"/admin/feedback-photo/{row.id}")
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg" and r.content == JPEG_BYTES
    assert c.get(f"/admin/feedback-photo/{uuid.uuid4()}").status_code == 404

    page = c.get("/admin/reader-feedback/list")
    assert page.status_code == 200 and f"/admin/feedback-photo/{row.id}" in page.text
