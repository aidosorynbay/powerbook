"""Messages between readers on the site (2026-10-15): only after a yes (16+); to someone who did not add you
back a first message is a request whose words stay hidden until accepted; blocking stops both sides; block and
complaint work without the yes; a push says who wrote and never what; the account takes everything with it but
the complaints about it."""
from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.models.buddy import ReadingBuddy
from app.models.chat import BuddyMessage, ChatConsent, ChatReport
from app.models.enums import Gender
from app.models.notification import NotificationPref
from app.models.user import User
from app.services import admin_ping, buddy_chat, push


@pytest.fixture()
def env(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    # as in production since n4p5q6r7s8t9: deleting an account clears the gender
    monkeypatch.setattr(User.__table__.c.gender, "nullable", True)
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False, autocommit=False)()
    users = {}
    for name in ("aigerim", "dana", "stranger"):
        users[name] = User(username=name, display_name=name.title(), password_hash="x", gender=Gender.female, telegram_id=name)
        db.add(users[name])
    db.flush()
    db.add(ReadingBuddy(user_id=users["aigerim"].id, buddy_user_id=users["dana"].id))
    db.commit()
    told: list = []
    pushed: list = []
    monkeypatch.setattr(admin_ping, "tell_admins", lambda text, buttons=None: told.append(text))
    monkeypatch.setattr(push, "send_to_user", lambda _db, user_id, payload: pushed.append((user_id, payload)) or 1)
    yield db, users, told, pushed
    db.close()


def code(fn) -> object:
    try:
        fn()
    except HTTPException as exc:
        return exc.detail
    return None


def test_consent_comes_first_and_must_be_both_ticks(env):
    db, u, told, pushed = env
    assert code(lambda: buddy_chat.send(db, u["aigerim"], u["dana"].id, "Сәлем!")) == "consent_required"
    assert code(lambda: buddy_chat.give_consent(db, u["aigerim"], age_16=True, agree=False)) == "consent_required"
    assert code(lambda: buddy_chat.give_consent(db, u["aigerim"], age_16=False, agree=True)) == "consent_required"
    buddy_chat.give_consent(db, u["aigerim"], age_16=True, agree=True)
    row = db.get(ChatConsent, u["aigerim"].id)
    assert row.version == buddy_chat.CONSENT_VERSION and row.accepted_at is not None
    buddy_chat.send(db, u["aigerim"], u["dana"].id, "Сәлем!")
    # Dana has not said yes: she sees who wrote and how many, never the words
    [entry] = buddy_chat.conversations(db, u["dana"])
    assert entry["name"] == "Aigerim" and entry["unread"] == 1 and entry["last_text"] == "" and entry["request"]
    chat = buddy_chat.conversation(db, u["dana"], u["aigerim"].id)
    assert chat["consented"] is False and chat["messages"] == [] and chat["waiting"] == 1
    assert code(lambda: buddy_chat.accept(db, u["dana"], u["aigerim"].id)) == "consent_required"


def test_a_first_message_is_a_request_until_accepted(env):
    db, u, told, pushed = env
    for name in u:
        buddy_chat.give_consent(db, u[name], age_16=True, agree=True)
    # a stranger who has not added Dana cannot write at all
    assert code(lambda: buddy_chat.send(db, u["stranger"], u["dana"].id, "привет")) == "not_buddy"
    # Aigerim added Dana, Dana did not add her back: a request, its words hidden
    out = buddy_chat.send(db, u["aigerim"], u["dana"].id, "Сәлем! Қандай кітап оқып жүрсің?")
    assert out["messages"][-1]["mine"] and out["pending"]
    assert pushed == [(u["dana"].id, {"title": "Aigerim", "body": "Хочет переписываться", "url": f"/messages?u={u['aigerim'].id}", "tag": f"buddy-{u['aigerim'].id}"})]
    chat = buddy_chat.conversation(db, u["dana"], u["aigerim"].id)
    assert chat["request"] and chat["messages"] == [] and not chat["can_write"]
    assert code(lambda: buddy_chat.send(db, u["dana"], u["aigerim"].id, "?")) == "request"
    # a request waits with three messages at most, and pushes once
    buddy_chat.send(db, u["aigerim"], u["dana"].id, "2")
    buddy_chat.send(db, u["aigerim"], u["dana"].id, "3")
    assert code(lambda: buddy_chat.send(db, u["aigerim"], u["dana"].id, "4")) == "waiting"
    assert len(pushed) == 1
    # Dana accepts: the words open, reading marks them read, and both may write; pushes say «Новое сообщение»
    chat = buddy_chat.accept(db, u["dana"], u["aigerim"].id)
    assert [m["text"] for m in chat["messages"]][0].startswith("Сәлем") and chat["can_write"]
    assert buddy_chat.unread(db, u["dana"]) == (0, True)
    buddy_chat.send(db, u["dana"], u["aigerim"].id, "Абай жолы!")
    buddy_chat.send(db, u["aigerim"], u["dana"].id, "Керемет")
    assert pushed[-1][1]["body"] == "Новое сообщение"
    assert not buddy_chat.conversation(db, u["aigerim"], u["dana"].id)["pending"]
    # Dana blocks: neither side can write; she can lift it
    assert buddy_chat.block(db, u["dana"], u["aigerim"].id, True)["i_blocked"]
    assert code(lambda: buddy_chat.send(db, u["aigerim"], u["dana"].id, "?")) == "blocked"
    assert code(lambda: buddy_chat.send(db, u["dana"], u["aigerim"].id, "?")) == "you_blocked"
    assert buddy_chat.block(db, u["dana"], u["aigerim"].id, False)["can_write"]
    # a reader who switched these pushes off still gets the message, without the push
    db.add(NotificationPref(user_id=u["dana"].id, kind="buddy_message", enabled=False))
    db.commit()
    pushed.clear()
    buddy_chat.send(db, u["aigerim"], u["dana"].id, "Керемет")
    assert pushed == []


def test_block_and_complaint_need_no_consent_and_say_nothing_to_telegram(env):
    db, u, told, pushed = env
    buddy_chat.give_consent(db, u["aigerim"], age_16=True, agree=True)
    buddy_chat.send(db, u["aigerim"], u["dana"].id, "что-то обидное")
    # Dana never said yes, and can still protect herself
    assert buddy_chat.block(db, u["dana"], u["aigerim"].id, True)["i_blocked"]
    buddy_chat.report(db, u["dana"], u["aigerim"].id, "Грубит")
    report = db.execute(select(ChatReport)).scalar_one()
    assert report.reason == "Грубит" and "что-то обидное" in report.excerpt and report.status == "new"
    assert "Жалоба" in told[-1] and "обидное" not in told[-1] and "Грубит" not in told[-1]


def test_deleting_an_account_takes_the_conversations_not_the_complaints_about_it(env):
    from app.core.security import hash_password
    from app.services.account_deletion import AccountDeletionService

    db, u, told, pushed = env
    for name in u:
        buddy_chat.give_consent(db, u[name], age_16=True, agree=True)
    buddy_chat.send(db, u["aigerim"], u["dana"].id, "Сәлем")
    buddy_chat.accept(db, u["dana"], u["aigerim"].id)
    buddy_chat.send(db, u["dana"], u["aigerim"].id, "Сәлем!")
    buddy_chat.report(db, u["aigerim"], u["dana"].id, "Проверка")
    u["dana"].password_hash = hash_password("pw123456")
    db.commit()
    AccountDeletionService(db).delete_account(user=u["dana"], password="pw123456")
    assert db.execute(select(BuddyMessage)).first() is None
    assert db.get(ChatConsent, u["dana"].id) is None
    assert db.execute(select(ChatReport.reason)).scalar_one() == "Проверка"
