"""«Что почитать дальше»: the AI librarian picks from the reader's marks, only books of the shared library, says why,
and learns from «Не моё» — with DeepSeek replaced by a stand-in."""
from __future__ import annotations

import json
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.core.config import settings
from app.core.security import create_access_token
from app.db.base import Base
from app.db.session import get_db
from app.main import create_app
from app.models.enums import Gender, RoundStatus, SystemRole
from app.models.group import Group
from app.models.notification import Notification
from app.models.round import ReadingLog, Round
from app.models.user import User
from app.services import catalog, librarian, llm
from tests.test_llm_book_chat import FakeDeepSeek

DANA_READ = [
    "Три товарища", "Триумфальная арка", "Цветы для Элджернона", "Мастер и Маргарита", "Стоунер", "Абай жолы",
    "Сто лет одиночества", "Тихий Дон", "Белая гвардия", "Собачье сердце", "Шантарам", "Норвежский лес",
]
MINE = ["Три товарища", "Маленький принц", "Обломов"]


class _Now:
    """The background writer, run in place, on the test's database."""

    def __init__(self, target, args, daemon=True):
        self.target, self.args = target, args

    def start(self):
        self.target(*self.args)


@pytest.fixture()
def env(monkeypatch):
    catalog.invalidate()
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    db = Session()
    me = User(username="aigerim", display_name="Aigerim", password_hash="x", gender=Gender.female, system_role=SystemRole.admin)
    dana = User(username="dana", display_name="Dana", password_hash="x", gender=Gender.female)
    db.add_all([me, dana])
    db.flush()
    group = Group(name="PowerBook", slug="powerbook", owner_user_id=dana.id)
    db.add(group)
    db.flush()
    rnd = Round(group_id=group.id, year=2026, month=9, status=RoundStatus.locked, end_day=None)
    db.add(rnd)
    db.flush()
    for i, title in enumerate(DANA_READ):
        db.add(ReadingLog(round_id=rnd.id, user_id=dana.id, date=date(2026, 9, 1 + i), minutes=40, score=1,
                          comment=title, book_finished=True))
    for i, title in enumerate(MINE):
        db.add(ReadingLog(round_id=rnd.id, user_id=me.id, date=date(2026, 9, 5 + i), minutes=40, score=1,
                          comment=title, book_finished=True))
    db.commit()

    monkeypatch.setattr(settings, "deepseek_api_key", "sk-test")
    monkeypatch.setattr(settings, "anthropic_api_key", "")
    monkeypatch.setattr(librarian.threading, "Thread", _Now)
    from app.services.bookcase import BookcaseService

    # no cover lookups over the network
    monkeypatch.setattr(BookcaseService, "_apply_covers", lambda self, volumes, lookups: None)
    import app.db.session as session_module

    monkeypatch.setattr(session_module, "get_session_factory", lambda: Session)

    def deepseek(replies):
        fake = FakeDeepSeek(replies)
        monkeypatch.setattr(llm.urllib.request, "urlopen", fake)
        return fake

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
    yield type("Env", (), dict(db=db, client=client, h=h, me=me, dana=dana, deepseek=staticmethod(deepseek), Session=Session))
    catalog.invalidate()


def _mark(env, title: str, rating: int, text: str | None = None, headers=None):
    catalog.invalidate()
    h = headers or env.h
    books = env.client.get("/api/library/bookcase", headers=h).json()["books"]
    vol = next(b for b in books if b["title"] == title)
    return env.client.put("/api/books/reviews", json={"volume_key": vol["key"], "rating": rating, "text": text}, headers=h)


def _id_of(fake, title: str) -> str:
    return next(c["id"] for c in _candidates(fake) if c["title"] == title)


def _candidates(fake) -> list[dict]:
    return json.loads(fake.requests[-1]["body"]["messages"][1]["content"])["candidates"]


def _ask_first(env, fake_replies):
    """Picks written by the stand-in; the stand-in returned, with what it was asked."""
    fake = env.deepseek(fake_replies)
    out = env.client.post("/api/reading/picks", json={"lang": "ru"}, headers=env.h)
    assert out.status_code == 202, out.json()
    return fake


def test_few_books_known_no_picks_yet(env):
    c = env.client
    other = User(username="new", display_name="New", password_hash="x", gender=Gender.male, system_role=SystemRole.admin)
    env.db.add(other)
    env.db.commit()
    oh = {"Authorization": f"Bearer {create_access_token(subject=str(other.id))}"}
    got = c.get("/api/reading/picks", headers=oh).json()
    assert got["has_taste"] is False and got["marks_missing"] == 3
    assert c.post("/api/reading/picks", json={"lang": "ru"}, headers=oh).json()["detail"] == "nothing_to_go_on"
    # three books read but no mark at all: still nothing — one mark is the least to go on
    assert c.get("/api/reading/picks", headers=env.h).json()["has_taste"] is False
    env.deepseek([])
    _mark(env, "Обломов", 6)
    assert c.get("/api/reading/picks", headers=env.h).json()["has_taste"] is True


def test_picks_come_only_from_the_library_say_why_and_name_a_person(env):
    c, h = env.client, env.h
    dh = {"Authorization": f"Bearer {create_access_token(subject=str(env.dana.id))}"}
    env.deepseek([])
    # Dana loved «Три товарища» as I did, and «Триумфальная арка» even more
    _mark(env, "Три товарища", 9, headers=dh)
    _mark(env, "Триумфальная арка", 10, headers=dh)
    _mark(env, "Обломов", 6, "про лень и доброту")
    _mark(env, "Три товарища", 9, "про дружбу")  # loved: the picks come by themselves

    # (they came by themselves with the 9 above: ask again to see what is sent)
    stand_in = env.deepseek(['{"taste": "t", "picks": []}'])
    c.post("/api/reading/picks", json={"lang": "ru", "force": True}, headers=h)
    body = json.loads(stand_in.requests[-1]["body"]["messages"][1]["content"])
    sent = body["candidates"]
    titles = [x["title"] for x in sent]
    # read books are never candidates; what kin loved comes first, and carries the person
    assert not {"Три товарища", "Обломов", "Маленький принц"} & set(titles)
    assert titles[0] == "Триумфальная арка"
    assert sent[0]["loved_by"] == [{"name": "Dana", "mark": 10, "also_loved_your": {"title": "Три товарища", "their_mark": 9}}]
    assert {"title": "Три товарища", "author": None, "mark": 9, "their_words": "про дружбу"} in body["reader"]["marks"]
    assert "_known" not in body["reader"]

    arch, stoner, dog = sent[0]["id"], _id_of(stand_in, "Стоунер"), _id_of(stand_in, "Собачье сердце")
    env.deepseek([json.dumps({
        "taste": "Вы любите тихие книги о дружбе.",
        "picks": [
            {"id": arch, "why": "Dana тоже поставила 9 «Трём товарищам» — а этой книге 10."},
            {"id": "b99", "why": "Книга, которой нет"},
            {"id": dog, "why": "Вы поставили 10 «Войне и миру»."},  # a mark the reader never gave: dropped
            {"id": arch, "why": "дважды"},
            {"id": stoner, "why": "Тихая жизнь, как в «Обломове»."},
        ],
    }, ensure_ascii=False)])
    c.post("/api/reading/picks", json={"lang": "ru", "force": True}, headers=h)
    picks = c.get("/api/reading/picks?lang=ru", headers=h).json()
    assert picks["status"] == "done" and picks["taste"].startswith("Вы любите")
    assert [p["book"]["title"] for p in picks["picks"]] == ["Триумфальная арка", "Стоунер"]
    assert "Dana" in picks["picks"][0]["why"] and picks["picks"][0]["want_id"] is None

    # the same taste: kept, nothing asked again
    fake = env.deepseek([])
    c.post("/api/reading/picks", json={"lang": "ru"}, headers=h)
    assert fake.requests == []

    # «Хочу прочитать» from a pick: it stays shown, as on the list, and the taste has changed
    first = picks["picks"][0]["book"]
    want_id = c.post("/api/library/want", json={"title": first["title"], "work_key": first["key"]}, headers=h).json()["id"]
    again = c.get("/api/reading/picks?lang=ru", headers=h).json()
    assert again["picks"][0]["want_id"] == want_id and again["stale"] is True


def test_not_for_me_is_never_suggested_again_and_is_told_to_the_ai(env):
    c, h = env.client, env.h
    env.deepseek([])
    _mark(env, "Обломов", 7)
    fake = _ask_first(env, [json.dumps({"taste": "t", "picks": [{"id": "b1", "why": "w"}]})])
    title = _candidates(fake)[0]["title"]
    key = c.get("/api/reading/picks?lang=ru", headers=h).json()["picks"][0]["book"]["key"]

    assert c.post("/api/reading/picks/dismiss", json={"work_key": key}, headers=h).status_code == 204
    shown = c.get("/api/reading/picks?lang=ru", headers=h).json()
    assert shown["picks"] == [] and shown["stale"] is True

    fake = _ask_first(env, [json.dumps({"taste": "t", "picks": [{"id": "b1", "why": "w"}]})])
    body = json.loads(fake.requests[-1]["body"]["messages"][1]["content"])
    assert title in body["reader"]["not_for_me"]
    assert title not in {x["title"] for x in body["candidates"]}

    # taken back: a candidate again
    assert c.delete(f"/api/reading/picks/dismiss?work_key={key}", headers=h).status_code == 204
    fake = env.deepseek([json.dumps({"taste": "t", "picks": [{"id": "b1", "why": "w"}]})])
    c.post("/api/reading/picks", json={"lang": "ru", "force": True}, headers=h)
    assert title in {x["title"] for x in _candidates(fake)}


def test_a_loved_book_brings_picks_by_itself_without_the_bell_for_now(env, monkeypatch):
    env.deepseek([])
    _mark(env, "Обломов", 6)
    env.deepseek([json.dumps({"taste": "t", "picks": [{"id": "b2", "why": "потому что"}]})])
    assert _mark(env, "Три товарища", 9).status_code == 200
    picks = env.client.get("/api/reading/picks?lang=ru", headers=env.h).json()
    assert picks["status"] == "done" and len(picks["picks"]) == 1
    db = env.Session()
    assert db.query(Notification).filter_by(user_id=env.me.id, kind="picks").count() == 0

    # another loved book the same day: no second round by itself
    fake = env.deepseek([])
    _mark(env, "Маленький принц", 10)
    assert fake.requests == []

    # with the bell on, it says so
    monkeypatch.setattr(librarian, "AUTO_BELL", True)
    monkeypatch.setattr(librarian, "AUTO_EVERY", librarian.timedelta(0))
    env.deepseek([json.dumps({"taste": "t", "picks": [{"id": "b3", "why": "w"}]})])
    _mark(env, "Маленький принц", 9)
    bell = env.Session().query(Notification).filter_by(user_id=env.me.id, kind="picks").all()
    assert len(bell) == 1 and bell[0].data["title"] == "Маленький принц"


def test_only_admins_until_it_is_for_everyone(env, monkeypatch):
    dh = {"Authorization": f"Bearer {create_access_token(subject=str(env.dana.id))}"}
    assert env.client.get("/api/reading/picks", headers=dh).json()["enabled"] is False
    assert env.client.post("/api/reading/picks", json={"lang": "ru"}, headers=dh).status_code == 404
    monkeypatch.setattr(librarian, "FOR_EVERYONE", True)
    assert env.client.get("/api/reading/picks", headers=dh).json()["enabled"] is True
