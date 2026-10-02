"""DeepSeek behind every AI feature, and «Обсудить с AI» about a book —
with the HTTP call to DeepSeek replaced by a stand-in."""
from __future__ import annotations

import json

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
from app.models.enums import Gender
from app.models.manual_book import ManualBook
from app.models.user import User
from app.services import catalog, llm


# A reply that never comes: blank lines for as long as the client reads, the
# way DeepSeek keeps a waiting request open.
BUSY = object()


class FakeDeepSeek:
    """Answers queued replies and remembers what was asked. A reply is the
    answer's text, a whole response body (a dict), or BUSY."""

    def __init__(self, replies: list):
        self.replies = list(replies)
        self.requests: list[dict] = []

    def __call__(self, request, timeout=None):
        self.requests.append(
            {"url": request.full_url, "headers": dict(request.header_items()), "body": json.loads(request.data), "timeout": timeout}
        )
        reply = self.replies.pop(0) if self.replies else "ok"
        if reply is BUSY:
            pieces = iter(lambda: b"\n", None)
        else:
            payload = reply if isinstance(reply, dict) else {"choices": [{"message": {"role": "assistant", "content": reply}, "finish_reason": "stop"}]}
            pieces = iter([json.dumps(payload).encode()])

        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def read1(self, n=-1):
                return next(pieces, b"")

        return Response()


@pytest.fixture()
def deepseek(monkeypatch):
    monkeypatch.setattr(settings, "deepseek_api_key", "sk-test")
    monkeypatch.setattr(settings, "anthropic_api_key", "")

    def install(replies):
        fake = FakeDeepSeek(replies)
        monkeypatch.setattr(llm.urllib.request, "urlopen", fake)
        return fake

    return install


SCHEMA = {
    "type": "object",
    "properties": {
        "headline": {"type": "string"},
        "ideas": {"type": "array", "items": {"type": "object", "properties": {"title": {"type": "string"}}, "required": ["title"]}},
    },
    "required": ["headline", "ideas"],
}


def test_without_any_key_ai_waits(monkeypatch):
    monkeypatch.setattr(settings, "deepseek_api_key", "")
    monkeypatch.setattr(settings, "anthropic_api_key", "")
    assert llm.available() is False
    with pytest.raises(llm.AiUnavailable):
        llm.chat(system="s", messages=[{"role": "user", "content": "hi"}])


def test_json_answers_are_asked_in_json_mode_and_retried_when_the_shape_is_wrong(deepseek):
    fake = deepseek(['{"ideas": []}', '{"headline": "Год книг", "ideas": [{"title": "A"}, {"oops": 1}], "extra": 5}'])
    out = llm.ask_json(system="Write a letter.", prompt="{}", schema=SCHEMA)
    # the first answer had no headline: asked again; stray keys and broken items are dropped
    assert out == {"headline": "Год книг", "ideas": [{"title": "A"}]}
    first = fake.requests[0]
    assert first["url"] == "https://api.deepseek.com/chat/completions"
    assert first["headers"]["Authorization"] == "Bearer sk-test"
    body = first["body"]
    assert body["model"] == "deepseek-flash" and body["response_format"] == {"type": "json_object"}
    assert body["thinking"] == {"type": "disabled"}
    assert "json" in body["messages"][0]["content"].lower() and '"headline"' in body["messages"][0]["content"]
    assert llm.model_name() == "deepseek-flash"


def test_a_busy_deepseek_is_given_up_not_waited_for(deepseek, monkeypatch):
    """Sentry POWERBOOK-BACKEND-3: blank lines kept one letter waiting
    15 minutes a try, past the socket timeout."""
    seconds = iter(range(0, 100_000, 5))  # every look at the clock, five seconds on
    monkeypatch.setattr(llm, "time", type("Clock", (), {"monotonic": staticmethod(lambda: next(seconds))}))

    fake = deepseek([BUSY])
    with pytest.raises(llm.AiUnavailable):
        llm.ask_json(system="Write a letter.", prompt="{}", schema=SCHEMA)
    assert len(fake.requests) == 1 and fake.requests[0]["timeout"] <= 120
    assert next(seconds) <= llm.LETTER_WITHIN + 20

    deepseek([BUSY])
    start = next(seconds)
    with pytest.raises(llm.AiUnavailable):
        llm.chat(system="s", messages=[{"role": "user", "content": "hi"}])
    assert next(seconds) - start <= llm.REPLY_WITHIN + 20


def test_empty_answers_and_errors_under_a_200_are_not_letters(deepseek):
    deepseek(["", ""])
    with pytest.raises(ValueError):
        llm.ask_json(system="Write a letter.", prompt="{}", schema=SCHEMA)
    deepseek([{"error": {"message": "Request timed out", "type": "timeout"}}])
    with pytest.raises(llm.AiUnavailable):
        llm.ask_json(system="Write a letter.", prompt="{}", schema=SCHEMA)


@pytest.fixture()
def env(deepseek):
    catalog.invalidate()
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    db = Session()
    reader = User(username="dana", display_name="Дана", password_hash="x", gender=Gender.female)
    db.add(reader)
    db.flush()
    book = ManualBook(user_id=reader.id, title="Мастер и Маргарита", title_norm="мастер и маргарита", author="Михаил Булгаков")
    db.add(book)
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
    headers = {"Authorization": f"Bearer {create_access_token(subject=str(reader.id))}"}
    yield type("Env", (), dict(db=db, client=client, headers=headers, reader=reader, book=book, deepseek=deepseek))
    catalog.invalidate()


def test_talking_about_a_book_from_the_shelf(env, monkeypatch):
    c = env.client
    key = f"m:{env.book.id}"
    c.put("/api/books/reviews", json={"volume_key": key, "rating": 9, "text": "Воланд!"}, headers=env.headers)
    catalog.invalidate()

    fake = env.deepseek(["Это роман о свободе и выборе."])
    r = c.post("/api/books/chat", json={"volume_key": key, "text": "О чём эта книга?", "lang": "ru"}, headers=env.headers)
    assert r.status_code == 200, r.text
    assert [m["role"] for m in r.json()["messages"]] == ["user", "assistant"]
    assert r.json()["messages"][1]["content"] == "Это роман о свободе и выборе."

    system = fake.requests[0]["body"]["messages"][0]["content"]
    assert "Мастер и Маргарита" in system and "9/10" in system and "Воланд!" in system and "Russian" in system
    assert fake.requests[0]["body"].get("response_format") is None

    state = c.get("/api/books/chat", params={"volume_key": key}, headers=env.headers).json()
    assert state["available"] is True and len(state["messages"]) == 2
    assert state["left_today"] == settings.ai_chat_daily_limit - 1

    # The day's allowance is a hard stop.
    monkeypatch.setattr(settings, "ai_chat_daily_limit", 1)
    again = c.post("/api/books/chat", json={"volume_key": key, "text": "А ещё?", "lang": "ru"}, headers=env.headers)
    assert again.status_code == 429 and again.json()["detail"] == "ai_daily_limit"

    assert c.delete("/api/books/chat", params={"volume_key": key}, headers=env.headers).status_code == 204
    assert c.get("/api/books/chat", params={"volume_key": key}, headers=env.headers).json()["messages"] == []


def test_a_message_must_be_something_and_not_a_book(env):
    key = f"m:{env.book.id}"
    assert env.client.post("/api/books/chat", json={"volume_key": key, "text": "   "}, headers=env.headers).status_code == 400
    long = env.client.post("/api/books/chat", json={"volume_key": key, "text": "а" * 1001}, headers=env.headers)
    assert long.status_code == 400 and long.json()["detail"] == "message_too_long"
    assert env.client.get("/api/books/chat", params={"volume_key": "m:00000000-0000-0000-0000-000000000000"}, headers=env.headers).status_code == 404
