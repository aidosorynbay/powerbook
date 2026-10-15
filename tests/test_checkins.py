"""«Хей, как вы?»: the founder hears each morning who has been quiet three days, nothing goes out without his ✅,
it reaches the reader in the afternoon of their own day, and the reader's answer comes back to him (2026-10-15)."""
from __future__ import annotations

from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.models.checkin import Checkin, DirectMessage
from app.models.enums import Gender, RoundParticipantStatus, RoundStatus, SystemRole
from app.models.group import Group
from app.models.notification import Notification, NotificationPref
from app.models.round import ReadingLog, Round, RoundParticipant
from app.models.user import User
from app.services import admin_ping, checkins, push

ALMATY = ZoneInfo("Asia/Almaty")
OCT_1 = datetime(2026, 10, 1, 9, tzinfo=ALMATY)


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
    for name, day in (("quiet", 10), ("reader", 13), ("muted", 9), ("left", 9)):
        db.add(ReadingLog(round_id=october.id, user_id=users[name].id, date=date(2026, 10, day), minutes=40, score=1))
    db.add(NotificationPref(user_id=users["muted"].id, kind="checkin", enabled=False))
    db.commit()
    told: list = []
    pushed: list = []
    monkeypatch.setattr(admin_ping, "tell_admins", lambda text, buttons=None: told.append((text, buttons)))
    monkeypatch.setattr(push, "send_to_user", lambda _db, user_id, payload: pushed.append((user_id, payload)) or 1)
    yield db, users, october, told, pushed
    db.close()


def at(day: int, hour: int) -> datetime:
    return datetime(2026, 10, day, hour, 5, tzinfo=ALMATY).astimezone(timezone.utc)


def test_the_morning_list_and_the_founders_yes(env):
    db, users, october, told, pushed = env
    assert checkins.plan(db, at(15, 9)) == []  # before ten in the morning
    planned = checkins.plan(db, at(15, 10))
    # the reader who read on the 13th, the one who switched it off, the one who left and the one who only
    # just joined are not quiet
    assert {c.user_id for c in planned} == {users["quiet"].id, users["never"].id}
    assert all(c.status == "planned" for c in planned)
    text, buttons = told[0]
    assert "Quiet" in text and "Never" in text and "ещё не отмечал" in text
    assert buttons[0][0]["callback_data"] == "ci:all:2026-10-15"
    # the scheduler ticks every minute: the founder hears the list once
    assert checkins.plan(db, at(15, 11)) == []
    assert len(told) == 1

    # nothing goes out without his ✅
    assert checkins.deliver(db, at(15, 12)) == 0
    never = next(c for c in planned if c.user_id == users["never"].id)
    verdict, line, left = checkins.decide(db, f"ci:x:{never.id}")
    assert "Never" in line and len(left) == 2  # «Отправить всем (1)» and one ❌ left
    verdict, line, _ = checkins.decide(db, "ci:all:2026-10-15")
    assert "Quiet" in line and "Never" not in line
    assert checkins.decide(db, "ci:all:2026-10-15")[0] == "Уже решено"

    # never at night or in the morning: from 11:00 of the reader's day
    assert checkins.deliver(db, at(15, 10)) == 0
    assert checkins.deliver(db, at(15, 11)) == 1
    assert checkins.deliver(db, at(15, 12)) == 0
    msg = db.execute(select(DirectMessage)).scalar_one()
    assert msg.reader_id == users["quiet"].id and msg.author_id == users["founder"].id
    # one message, one signal: the speech bubble by the bell, not the bell too
    assert db.execute(select(Notification.id)).first() is None
    assert checkins.unread(db, db.get(User, users["quiet"].id)) == {"count": 1, "has_thread": True}
    assert [u for u, _ in pushed] == [users["quiet"].id]
    assert pushed[0][1]["title"] == "Founder"


def test_the_readers_answer_reaches_the_founder(env, monkeypatch):
    db, users, october, told, pushed = env
    checkins.plan(db, at(15, 10))
    checkins.decide(db, "ci:all:2026-10-15")
    checkins.deliver(db, at(15, 13))
    quiet = db.get(User, users["quiet"].id)
    card = checkins.card(db, quiet)
    assert card and card["from"] == "Founder"
    # the 15th: sign-ups closed on the 10th, so «Пока не участвую» is not offered; on the 8th it was
    real_day = checkins.reading_day
    monkeypatch.setattr(checkins, "reading_day", lambda *a: date(2026, 10, 15))
    card = checkins.card(db, quiet)
    assert "out" not in card["answers"] and "hard" in card["answers"]
    monkeypatch.setattr(checkins, "reading_day", lambda *a: date(2026, 10, 8))
    assert "out" in checkins.card(db, quiet)["answers"]
    monkeypatch.setattr(checkins, "reading_day", real_day)
    out = checkins.answer(db, quiet, __import__("uuid").UUID(card["id"]), "hard", "ru")
    assert out["card"] is None
    assert [m["text"] for m in out["messages"]][-1] == "Сейчас сложный период"
    assert "Quiet" in told[-1][0] and "сложный период" in told[-1][0]
    # the founder sees it waiting, answers, and the reader hears
    founder = db.get(User, users["founder"].id)
    assert checkins.unread(db, founder)["count"] == 1
    assert checkins.threads(db)[0]["unread"] == 1
    checkins.reply(db, founder, quiet.id, "Понимаю. Хоть 10 минут перед сном — уже хорошо.")
    assert checkins.unread(db, founder)["count"] == 0
    assert checkins.unread(db, quiet)["count"] == 1
    assert "10.10" in checkins.thread_for(db, founder, quiet.id)["context"]
    # nobody else can open a line to the founder's Telegram
    with pytest.raises(Exception):
        checkins.write(db, db.get(User, users["reader"].id), "привет")
    # she reads again the next day: counted as come back within two days
    db.add(ReadingLog(round_id=october.id, user_id=quiet.id, date=date(2026, 10, 16), minutes=35, score=1))
    db.commit()
    s = checkins.stats(db, today=date(2026, 10, 17))
    assert (s["sent"], s["answered"], s["returned"]) == (2, 1, 1)  # «never» got one too, and is still quiet
    # a pause is written about once: on the 17th only the readers who have gone quiet since are on the list
    assert {c.user_id for c in checkins.plan(db, at(17, 10))} == {users["reader"].id, users["late"].id}


def test_back_before_it_went_out_or_nobody_said_yes(env):
    db, users, october, told, pushed = env
    checkins.plan(db, at(15, 10))
    checkins.decide(db, "ci:all:2026-10-15")
    db.add(ReadingLog(round_id=october.id, user_id=users["quiet"].id, date=date(2026, 10, 15), minutes=20, score=0))
    db.commit()
    assert checkins.deliver(db, at(15, 12)) == 1  # only «never»
    assert db.execute(select(Checkin.status).where(Checkin.user_id == users["quiet"].id)).scalar_one() == "cancelled"
    # a list nobody said yes to is gone with its day
    for row in db.execute(select(Checkin)).scalars():
        row.status = "planned"
    db.commit()
    checkins.plan(db, at(16, 10))
    assert set(db.execute(select(Checkin.status)).scalars()) == {"expired"}


def test_never_in_the_circles_first_days(env):
    db, users, october, told, pushed = env
    assert checkins.plan(db, at(3, 10)) == []
