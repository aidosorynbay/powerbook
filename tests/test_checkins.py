"""«Как вы?»: PowerBook notices who has been quiet three days and writes on its own, at the hour the reader
usually reads, about their circle today, at most twice in a pause; the founder hears who answered and answers
in his own name (2026-10-15)."""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.core.config import settings
from app.db.base import Base
from app.models.checkin import Checkin, DirectMessage
from app.models.enums import Gender, RoundParticipantStatus, RoundStatus, SystemRole
from app.models.group import Group
from app.models.notification import Notification, NotificationPref
from app.models.push import ReadingReminder
from app.models.round import ReadingLog, Round, RoundParticipant
from app.models.user import User
from app.services import admin_ping, checkins, push

ALMATY = ZoneInfo("Asia/Almaty")
OCT_1 = datetime(2026, 10, 1, 9, tzinfo=ALMATY)


def at(day: int, hour: int) -> datetime:
    return datetime(2026, 10, day, hour, 5, tzinfo=ALMATY).astimezone(timezone.utc)


@pytest.fixture()
def env(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False, autocommit=False)()
    users = {}
    for name in ("founder", "quiet", "reader", "never", "muted", "left", "late"):
        users[name] = User(username=name, display_name=name.title(), password_hash="x", gender=Gender.female, telegram_id=name)
        db.add(users[name])
    users["founder"].system_role = SystemRole.superadmin
    db.flush()
    group = Group(name="PowerBook", slug="powerbook", owner_user_id=users["founder"].id)
    db.add(group)
    db.flush()
    october = Round(group_id=group.id, year=2026, month=10, status=RoundStatus.locked, registration_open_until_day=10)
    db.add(october)
    db.flush()
    for name in ("quiet", "reader", "never", "muted", "left", "late"):
        db.add(RoundParticipant(
            round_id=october.id, user_id=users[name].id,
            status=RoundParticipantStatus.left_before_deadline if name == "left" else RoundParticipantStatus.active,
            joined_at=datetime(2026, 10, 14, 9, tzinfo=ALMATY) if name == "late" else OCT_1,
        ))
    # Quiet used to log at half past eight in the evening
    for day in (8, 9, 10):
        db.add(ReadingLog(round_id=october.id, user_id=users["quiet"].id, date=date(2026, 10, day), minutes=40, score=1,
                          updated_at=datetime(2026, 10, day, 20, 30, tzinfo=ALMATY).astimezone(timezone.utc)))
    for name, day in (("reader", 13), ("muted", 9), ("left", 9)):
        db.add(ReadingLog(round_id=october.id, user_id=users[name].id, date=date(2026, 10, day), minutes=40, score=1))
    # the circle today
    db.add(ReadingLog(round_id=october.id, user_id=users["reader"].id, date=date(2026, 10, 15), minutes=412, score=1))
    db.add(NotificationPref(user_id=users["muted"].id, kind="checkin", enabled=False))
    db.commit()
    told: list = []
    pushed: list = []
    monkeypatch.setattr(admin_ping, "tell_admins", lambda text, buttons=None: told.append((text, buttons)))
    monkeypatch.setattr(push, "send_to_user", lambda _db, user_id, payload: pushed.append((user_id, payload)) or 1)
    monkeypatch.setattr(settings, "checkin_auto", True)
    monkeypatch.setattr(settings, "checkin_voice", "powerbook")
    yield db, users, october, told, pushed
    db.close()


def test_powerbook_writes_on_its_own_at_the_readers_hour(env):
    db, u, october, told, pushed = env
    assert checkins.plan(db, at(15, 9)) == []  # before ten in the morning
    planned = checkins.plan(db, at(15, 10))
    # the reader of the 13th, the one who switched it off, the one who left and the latecomer are not quiet
    assert {c.user_id for c in planned} == {u["quiet"].id, u["never"].id}
    assert all(c.status == "approved" and c.step == 1 for c in planned)
    text, buttons = told[0]
    assert "PowerBook напишет" in text and "Quiet" in text and "Подпись сообщений: PowerBook" in text
    # only «❌ name» to leave someone alone; no ✅ needed
    assert all(b["callback_data"].startswith("ci:x:") for row in buttons for b in row)
    assert checkins.plan(db, at(15, 11)) == []  # the list comes once

    # Never has no habit to read by: the evening (19:00). Quiet: her usual half past eight.
    assert checkins.deliver(db, at(15, 15)) == 0
    assert checkins.deliver(db, at(15, 19)) == 1
    assert checkins.deliver(db, at(15, 20)) == 1
    msg = db.execute(select(DirectMessage).where(DirectMessage.reader_id == u["quiet"].id)).scalar_one()
    assert msg.voice == "powerbook"
    assert msg.text == "Сәлем, қалайсыз? Кітап оқу қалай болып жатыр? Бүгін айналым қатысушылары 412 минут оқыды — қайта оралуға 10 минут та жетеді."
    assert {p["title"] for _, p in pushed} == {"PowerBook"}
    # one message, one signal: not the bell too
    assert db.execute(select(Notification.id)).first() is None
    quiet = db.get(User, u["quiet"].id)
    card = checkins.card(db, quiet)
    assert card["from"] == "PowerBook" and card["avatar_data"] == checkins.BRAND_AVATAR
    assert checkins.my_thread(db, quiet)["messages"][0]["author"] == "PowerBook"


def test_a_skipped_reader_hears_nothing(env):
    db, u, october, told, pushed = env
    checkins.plan(db, at(15, 10))
    never = db.execute(select(Checkin).where(Checkin.user_id == u["never"].id)).scalar_one()
    verdict, line, left = checkins.decide(db, f"ci:x:{never.id}")
    assert "Never" in line and all("Never" not in b["text"] for row in left for b in row)
    checkins.deliver(db, at(15, 20))
    assert [uid for uid, _ in pushed] == [u["quiet"].id]
    assert checkins.decide(db, f"ci:x:{never.id}")[0] == "Уже решено"


def test_the_readers_answer_reaches_the_founder_who_answers_in_his_name(env, monkeypatch):
    db, u, october, told, pushed = env
    checkins.plan(db, at(15, 10))
    checkins.deliver(db, at(15, 20))
    quiet = db.get(User, u["quiet"].id)
    card = checkins.card(db, quiet)
    # the 15th: sign-ups closed on the 10th, so «Пока не участвую» is not offered; on the 8th it was
    real_day = checkins.reading_day
    monkeypatch.setattr(checkins, "reading_day", lambda *a: date(2026, 10, 15))
    assert "out" not in checkins.card(db, quiet)["answers"]
    monkeypatch.setattr(checkins, "reading_day", lambda *a: date(2026, 10, 8))
    assert "out" in checkins.card(db, quiet)["answers"]
    monkeypatch.setattr(checkins, "reading_day", real_day)
    out = checkins.answer(db, quiet, uuid.UUID(card["id"]), "hard", "ru")
    assert out["card"] is None and out["messages"][-1]["text"] == "Сейчас сложный период"
    assert "Quiet" in told[-1][0] and "сложный период" not in told[-1][0]  # who answered, never what
    founder = db.get(User, u["founder"].id)
    assert checkins.unread(db, founder)["count"] == 1
    thread = checkins.thread_for(db, founder, quiet.id)
    assert thread["messages"][0]["author"] == "PowerBook" and not thread["messages"][0]["mine"]
    assert "10.10" in thread["context"]
    checkins.reply(db, founder, quiet.id, "Понимаю. Хоть 10 минут перед сном — уже хорошо.")
    assert checkins.my_thread(db, quiet)["messages"][-1]["author"] == "Founder"
    assert checkins.unread(db, founder)["count"] == 0
    # nobody else can open a line to the founder's Telegram
    with pytest.raises(Exception):
        checkins.write(db, db.get(User, u["reader"].id), "привет")
    # back the next day: counted
    db.add(ReadingLog(round_id=october.id, user_id=quiet.id, date=date(2026, 10, 16), minutes=35, score=1))
    db.commit()
    s = checkins.stats(db, today=date(2026, 10, 17))
    assert (s["sent"], s["answered"], s["returned"]) == (2, 1, 1)  # Never got one too, and is still quiet


def test_at_most_twice_in_a_pause_and_the_last_word_says_so(env):
    db, u, october, told, pushed = env
    first = [c for c in checkins.plan(db, at(14, 10)) if c.user_id == u["quiet"].id]  # read the 10th, quiet 11–13
    assert [c.step for c in first] == [1]
    checkins.deliver(db, at(14, 20))
    # not yet: a week of quiet comes on the 18th
    assert all(c.user_id != u["quiet"].id for c in checkins.plan(db, at(17, 10)))
    last = [c for c in checkins.plan(db, at(18, 10)) if c.user_id == u["quiet"].id]
    assert [c.step for c in last] == [2]
    checkins.deliver(db, at(18, 20))
    msg = db.execute(
        select(DirectMessage).where(DirectMessage.reader_id == u["quiet"].id).order_by(DirectMessage.created_at.desc())
    ).scalars().first()
    assert "Бұдан әрі еске салмаймыз" in msg.text
    # and then quiet
    assert all(c.user_id != u["quiet"].id for c in checkins.plan(db, at(25, 10)))


def test_english_readers_and_the_founders_own_voice(env, monkeypatch):
    db, u, october, told, pushed = env
    db.add(ReadingReminder(user_id=u["quiet"].id, enabled=False, hour=21, minute=0, tz="Asia/Almaty", locale="en"))
    db.commit()
    checkins.plan(db, at(15, 10))
    checkins.deliver(db, at(15, 20))
    msg = db.execute(select(DirectMessage).where(DirectMessage.reader_id == u["quiet"].id)).scalar_one()
    assert msg.text.startswith("Hi, how are you?") and "412 min" in msg.text
    # the old way stays a switch away: in the founder's name, saying the site told him
    monkeypatch.setattr(settings, "checkin_voice", "founder")
    assert checkins.compose("kk", 1, None).endswith("ал жауапты өзім жазамын.")
    assert checkins.card(db, db.get(User, u["quiet"].id))["from"] == "Founder"


def test_never_in_the_circles_first_days(env):
    db, u, october, told, pushed = env
    assert checkins.plan(db, at(3, 10)) == []
