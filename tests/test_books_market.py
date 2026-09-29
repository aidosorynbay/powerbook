"""The shared library, marks, the book market and the reading summaries,
against a throwaway SQLite database."""
from __future__ import annotations

from datetime import date, datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.core.booktitles import canonical_key
from app.core.security import create_access_token
from app.db.base import Base
from app.db.session import get_db
from app.main import create_app
from app.models.book_cover import BookCover
from app.models.book_fact import BookFact
from app.models.book_note import BookNote
from app.models.enums import Gender, RoundStatus
from app.models.group import Group
from app.models.manual_book import ManualBook
from app.models.round import ReadingLog, Round
from app.models.user import User
from app.repositories.insights import normalize_book_title
from app.services import catalog, covers


@pytest.fixture()
def env():
    catalog.invalidate()
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    db = Session()

    def user(name, telegram=None):
        u = User(username=name, display_name=name.title(), password_hash="x", gender=Gender.female, telegram_id=telegram)
        db.add(u)
        db.flush()
        return u

    madik, aigerim, dana = user("madik", "@makooo"), user("aigerim"), user("dana")
    group = Group(name="PowerBook", slug="powerbook", owner_user_id=madik.id)
    db.add(group)
    db.flush()
    rnd = Round(group_id=group.id, year=2026, month=9, status=RoundStatus.locked, end_day=None)
    db.add(rnd)
    db.flush()

    def finished(u, day, comment, private=False):
        db.add(ReadingLog(round_id=rnd.id, user_id=u.id, date=date(2026, 9, day), minutes=40, score=0,
                          comment=comment, book_finished=True, is_comment_private=private))

    # One book, three spellings; the cover lookup matched two of them to one edition.
    finished(madik, 3, "«Теория игр» Авинаш Диксит\nОчень понравилось")
    finished(aigerim, 5, "Теори игр (наконееец)")
    finished(madik, 10, "Atomic Habits")
    finished(aigerim, 12, "Сто лет одиночества")
    finished(dana, 14, "Секретный дневник", private=True)
    db.add(ManualBook(user_id=dana.id, title="Атомные привычки", title_norm="атомные привычки", author="Джеймс Клир"))
    db.add(ReadingLog(round_id=rnd.id, user_id=madik.id, date=date(2026, 9, 11), minutes=55, score=0))
    for key_title, fixed in (("Теория игр", None), ("Теори игр", "Теория игр")):
        db.add(BookCover(key=covers.cover_key(key_title), query=key_title, status="found", title=fixed,
                         author="Авинаш Диксит", source="google", source_id="G1", image="a" * 32,
                         checked_at=datetime.now(timezone.utc)))
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

    yield type("Env", (), dict(db=db, client=client, h=h, madik=madik, aigerim=aigerim, dana=dana))
    catalog.invalidate()


def _vol_key(comment: str) -> str:
    from app.services.bookcase import _short_hash

    return f"r:{_short_hash(normalize_book_title(comment))}"


def test_catalog_folds_spellings_and_keeps_private_books_out(env):
    r = env.client.get("/api/books/catalog", headers=env.h(env.aigerim))
    assert r.status_code == 200, r.text
    page = r.json()
    titles = {i["title"]: i for i in page["items"]}
    # «Теория игр» and "Теори игр" are one book, read by two people.
    assert "Теори игр" not in titles
    assert titles["Теория игр"]["readers"] == 2
    assert titles["Теория игр"]["cover_url"] == f"/library/covers/{'a' * 32}.jpg"
    # Atomic Habits and «Атомные привычки» are one book through the alias list.
    habits = [i for i in page["items"] if i["title"] in ("Atomic Habits", "Атомные привычки")]
    assert len(habits) == 1 and habits[0]["readers"] == 2
    # A private comment never reaches the shared library.
    assert not any("Секретный" in i["title"] for i in page["items"])
    assert page["counts"]["all"] == 3

    found = env.client.get("/api/books/catalog?q=теор", headers=env.h(env.aigerim)).json()
    assert [i["title"] for i in found["items"]] == ["Теория игр"]


def test_marks_are_given_on_the_shelf_and_show_everywhere(env):
    c = env.client
    vol = _vol_key("«Теория игр» Авинаш Диксит\nОчень понравилось")
    r = c.put("/api/books/reviews", json={"volume_key": vol, "rating": 9, "text": "Лучшая книга о стратегии"},
              headers=env.h(env.madik))
    assert r.status_code == 200, r.text
    r = c.put("/api/books/reviews", json={"volume_key": _vol_key("Теори игр (наконееец)"), "rating": 6},
              headers=env.h(env.aigerim))
    assert r.status_code == 200, r.text

    # Someone else's book cannot be marked from my shelf.
    r = c.put("/api/books/reviews", json={"volume_key": vol, "rating": 1}, headers=env.h(env.dana))
    assert r.status_code == 404

    page = c.get("/api/books/catalog?filter=rated", headers=env.h(env.dana)).json()
    assert [i["title"] for i in page["items"]] == ["Теория игр"]
    item = page["items"][0]
    assert item["pb_rating"] == 7.5 and item["pb_votes"] == 2 and item["pb_reviews"] == 1
    assert c.get("/api/books/catalog?filter=reviewed", headers=env.h(env.dana)).json()["total"] == 1

    work = c.get(f"/api/books/work/{item['key']}", headers=env.h(env.aigerim)).json()
    assert work["histogram"][8] == 1 and work["histogram"][5] == 1
    assert work["reviews"][0]["text"] == "Лучшая книга о стратегии"
    assert work["my_review"]["rating"] == 6
    assert work["my_volume_key"] == _vol_key("Теори игр (наконееец)")
    assert {r["display_name"] for r in work["readers_list"]} == {"Madik", "Aigerim"}
    # Any spelling's key opens the same page.
    assert c.get(f"/api/books/work/{canonical_key('Теори игр')}", headers=env.h(env.dana)).json()["key"] == item["key"]

    # On the reader's shelf, for the reader and for visitors.
    shelf = c.get(f"/api/library/bookcase/{env.madik.id}", headers=env.h(env.dana)).json()
    marked = next(b for b in shelf["books"] if b["key"] == vol)
    assert marked["rating"] == 9 and marked["review"] == "Лучшая книга о стратегии" and marked["review_id"] is None
    own = c.get("/api/library/bookcase", headers=env.h(env.madik)).json()
    assert next(b for b in own["books"] if b["key"] == vol)["review_id"]

    # Changing the mark replaces it; deleting takes it away.
    c.put("/api/books/reviews", json={"volume_key": vol, "rating": 10}, headers=env.h(env.madik))
    work = c.get(f"/api/books/work/{item['key']}", headers=env.h(env.madik)).json()
    assert work["pb_votes"] == 2 and work["my_review"]["rating"] == 10 and work["my_review"]["text"] is None
    assert c.delete(f"/api/books/reviews/{work['my_review']['id']}", headers=env.h(env.aigerim)).status_code == 404
    assert c.delete(f"/api/books/reviews/{work['my_review']['id']}", headers=env.h(env.madik)).status_code == 204
    assert c.get(f"/api/books/work/{item['key']}", headers=env.h(env.madik)).json()["pb_votes"] == 1


def test_external_facts_show_with_their_source(env):
    env.db.add(BookFact(key="teoriaigr", title="Теория игр", status="found", rating=4.1, ratings_count=5230,
                        rating_source="goodreads", rating_url="https://www.goodreads.com/book/show/1",
                        about={"ru": {"text": "Книга о стратегическом мышлении.", "source": "wikipedia", "url": "https://ru.wikipedia.org/x"}},
                        review={"ru": "Читатели хвалят примеры.", "en": "Readers praise the examples."},
                        review_source="goodreads", topics=["business", "psychology"]))
    env.db.commit()
    c = env.client
    item = next(i for i in c.get("/api/books/catalog?sort=ext", headers=env.h(env.dana)).json()["items"])
    assert item["title"] == "Теория игр" and item["ext_rating"] == 4.1 and item["ext_source"] == "goodreads"
    work = c.get(f"/api/books/work/{item['key']}?locale=en", headers=env.h(env.dana)).json()
    assert work["readers_say"]["text"] == "Readers praise the examples."
    assert work["about"]["source"] == "wikipedia"
    topic = c.get("/api/books/catalog?topic=business", headers=env.h(env.dana)).json()
    assert topic["total"] == 1 and topic["topics"]["psychology"] == 1


def test_market_listing_lifecycle(env):
    c = env.client
    vol = _vol_key("«Теория игр» Авинаш Диксит\nОчень понравилось")
    photo = "data:image/jpeg;base64," + "A" * 400
    r = c.post("/api/market", json={"title": "Теория игр", "price": 3500, "condition": "like_new", "city": "Алматы",
                                    "contact": "+7 701 000 00 00", "volume_key": vol, "photo": photo},
               headers=env.h(env.madik))
    assert r.status_code == 201, r.text
    listing = r.json()
    assert listing["seller"]["telegram"] == "makooo"
    assert listing["cover_url"] and listing["photo_url"]
    assert listing["work_key"]

    page = c.get("/api/market", headers=env.h(env.aigerim)).json()
    assert page["total"] == 1 and page["cities"] == ["Алматы"] and not page["items"][0]["is_mine"]
    assert page["items"][0]["volume_key"] is None
    assert c.get("/api/market?city=Астана", headers=env.h(env.aigerim)).json()["total"] == 0

    # The book's page in the shared library shows who sells it.
    work = c.get(f"/api/books/work/{listing['work_key']}", headers=env.h(env.aigerim)).json()
    assert work["for_sale"] == 1 and work["listings"][0]["price"] == 3500
    assert c.get("/api/books/catalog?filter=sale", headers=env.h(env.aigerim)).json()["total"] == 1

    photo_url = listing["photo_url"].split("?")[0]
    assert c.get(f"/api{photo_url}").status_code == 200

    # Only the seller changes it.
    assert c.patch(f"/api/market/{listing['id']}", json={"price": 1}, headers=env.h(env.aigerim)).status_code == 404
    r = c.patch(f"/api/market/{listing['id']}", json={"status": "sold"}, headers=env.h(env.madik))
    assert r.status_code == 200 and r.json()["status"] == "sold"
    assert c.get("/api/market", headers=env.h(env.aigerim)).json()["total"] == 0
    assert c.get(f"/api/market/user/{env.madik.id}", headers=env.h(env.aigerim)).json() == []
    assert len(c.get(f"/api/market/user/{env.madik.id}", headers=env.h(env.madik)).json()) == 1

    bad = c.post("/api/market", json={"title": "X", "price": 10, "contact": "+7 701 000 00 00", "photo": "data:text/html;base64,AAAA"},
                 headers=env.h(env.madik))
    assert bad.status_code == 400 and bad.json()["detail"] == "bad_photo"
    # A way to reach the seller is not optional: a phone of 10–15 digits.
    for contact in (None, "", "   ", "12345", "+7 (701) 12"):
        body = {"title": "X", "price": 10} | ({"contact": contact} if contact is not None else {})
        r = c.post("/api/market", json=body, headers=env.h(env.madik))
        assert r.status_code == 400 and r.json()["detail"] == "bad_phone", contact
    ok = c.post("/api/market", json={"title": "X", "price": 10, "contact": "8 (701) 555-12-34"}, headers=env.h(env.madik))
    assert ok.status_code == 201 and ok.json()["contact"] == "8 (701) 555-12-34"
    assert c.patch(f"/api/market/{ok.json()['id']}", json={"contact": ""}, headers=env.h(env.madik)).json()["detail"] == "bad_phone"
    assert c.delete(f"/api/market/{listing['id']}", headers=env.h(env.madik)).status_code == 204


def test_reading_overview_recommendations_and_notebook(env):
    c = env.client
    vol = _vol_key("«Теория игр» Авинаш Диксит\nОчень понравилось")
    env.db.add(BookNote(user_id=env.madik.id, volume_key=vol, text="Равновесие Нэша — главное"))
    env.db.commit()
    c.put("/api/books/reviews", json={"volume_key": vol, "rating": 9}, headers=env.h(env.madik))

    data = c.get("/api/reading/overview?period=2026-09", headers=env.h(env.madik)).json()
    assert data["minutes"] == 135 and data["days_read"] == 3
    assert {b["title"] for b in data["books"]} == {"Теория игр", "Atomic Habits"}
    assert data["avg_rating"] == 9 and data["notes_count"] == 1
    assert len(data["units"]) == 30
    year = c.get("/api/reading/overview?period=2026", headers=env.h(env.madik)).json()
    assert year["months"] == [9] and len(year["units"]) == 12
    assert c.get("/api/reading/overview?period=2026-13", headers=env.h(env.madik)).status_code == 400

    # Aigerim shares «Теория игр» with Madik, so his other book comes to her.
    recs = c.get("/api/reading/recommendations", headers=env.h(env.aigerim)).json()
    assert recs[0]["reason"] == "co_read"
    assert recs[0]["book"]["readers"] == 2 and recs[0]["because_title"] == "Теория игр"

    notebook = c.get("/api/reading/notebook", headers=env.h(env.madik)).json()
    entry = next(e for e in notebook if e["key"] == vol)
    assert entry["notes"][0]["text"] == "Равновесие Нэша — главное" and entry["comment"] and entry["rating"] == 9

    # Claude's letters wait for a key.
    r = c.post("/api/reading/digest", json={"kind": "period", "scope": "2026-09", "lang": "ru"}, headers=env.h(env.madik))
    assert r.status_code == 503 and r.json()["detail"] == "ai_off"
    assert c.get("/api/reading/digest?kind=period&scope=2026-09", headers=env.h(env.madik)).json() is None


def test_topics_from_catalogue_words():
    from app.services.topics import from_subjects

    assert from_subjects(["Self-Help / Personal Growth / Success"]) == ["self_help"]
    assert "psychology" in from_subjects(["Psychology / Cognitive Psychology & Cognition"])
    assert from_subjects(["Fiction"], year=1869) == ["classics"]
    assert from_subjects([], title="Қан мен тер") == ["kazakh"]
    assert from_subjects(["Fiction / Fantasy / Epic"]) == ["fantasy_scifi"]


class _Block:
    def __init__(self, text):
        self.type, self.text = "text", text


class _Response:
    def __init__(self, stop, text):
        self.stop_reason, self.stop_details = stop, None
        self.content = [_Block(text)]


class _FakeClient:
    """Answers like the API: one pause while searching, then the JSON."""

    def __init__(self, answers):
        self.calls = []
        answers = list(answers)
        outer = self

        class _Messages:
            def create(self, **kwargs):
                outer.calls.append(kwargs)
                return answers.pop(0)

        self.beta = type("B", (), {"messages": _Messages()})()


def test_claude_json_resumes_paused_turns_and_refuses_cleanly(monkeypatch):
    from app.services import claude

    fake = _FakeClient([_Response("pause_turn", "searching…"), _Response("end_turn", '{"ok": true}')])
    monkeypatch.setattr(claude, "_client", lambda: fake)
    assert claude.ask_json(system="s", prompt="p", schema={"type": "object"}, web_search=True) == {"ok": True}
    assert len(fake.calls) == 2 and fake.calls[1]["messages"][-1]["role"] == "assistant"
    assert fake.calls[0]["fallbacks"] == "default" and fake.calls[0]["tools"][0]["type"] == "web_search_20260209"

    monkeypatch.setattr(claude, "_client", lambda: _FakeClient([_Response("refusal", "")]))
    with pytest.raises(claude.AiRefused):
        claude.ask_json(system="s", prompt="p", schema={"type": "object"})


def test_book_facts_ai_pass_prefers_goodreads(monkeypatch):
    from app.services import book_facts, claude
    from app.services.catalog import Work

    answer = {
        "found": True, "source": "goodreads", "rating": 4.12, "ratings_count": 98765,
        "url": "https://www.goodreads.com/book/show/117833", "goodreads_url": "https://www.goodreads.com/book/show/117833",
        "about_ru": "Роман о дьяволе в Москве.", "about_kk": "Мәскеудегі шайтан туралы роман.", "about_en": "A novel about the devil in Moscow.",
        "readers_ru": "Хвалят сатиру.", "readers_kk": "Сатирасын мақтайды.", "readers_en": "Readers praise the satire.",
        "topics": ["classics", "fantasy_scifi", "nonsense"], "year": 1967,
    }
    monkeypatch.setattr(claude, "ask_json", lambda **kw: answer)
    fact = BookFact(key="masterimargarita", title="Мастер и Маргарита", status="found", rating=4.18, ratings_count=100,
                    rating_source="openlibrary", about={"ru": {"text": "Статья", "source": "wikipedia", "url": "u"}})
    book_facts.look_up_ai(fact, Work(key="k", members={"k"}, title="Мастер и Маргарита", author=None, image=None, source_url=None))
    assert (fact.rating, fact.ratings_count, fact.rating_source) == (4.12, 98765, "goodreads")
    assert fact.about["ru"]["source"] == "wikipedia" and fact.about["kk"]["source"] == "claude"
    assert fact.review["en"] == "Readers praise the satire." and fact.review_source == "goodreads"
    assert fact.topics == ["classics", "fantasy_scifi"] and fact.ai_status == "found"


def test_digest_is_written_in_the_background_and_kept(env, monkeypatch):
    from app.core.config import settings
    from app.services import claude, reading_ai

    monkeypatch.setattr(settings, "anthropic_api_key", "test")
    letter = {"headline": "Сентябрь стратегий", "summary": "…", "themes": [], "patterns": [], "from_notes": [],
              "next_reads": [], "question": "?"}
    monkeypatch.setattr(claude, "ask_json", lambda **kw: letter)
    started = []

    class _Now:
        def __init__(self, target, args, daemon):
            self.target, self.args = target, args

        def start(self):
            started.append(1)

    monkeypatch.setattr(reading_ai.threading, "Thread", _Now)
    c = env.client
    r = c.post("/api/reading/digest", json={"kind": "period", "scope": "2026-09", "lang": "ru"}, headers=env.h(env.madik))
    assert r.status_code == 202 and r.json()["status"] == "working" and started == [1]

    # What the thread would do, run here against the test database.
    from app.models.ai_digest import AiDigest

    row = env.db.get(AiDigest, __import__("uuid").UUID(r.json()["id"]))
    row.content, row.status = claude.ask_json(system="", prompt="", schema={}), "done"
    env.db.commit()
    got = c.get("/api/reading/digest?kind=period&scope=2026-09&lang=ru", headers=env.h(env.madik)).json()
    assert got["status"] == "done" and got["content"]["headline"] == "Сентябрь стратегий" and not got["stale"]
    # Asked again with nothing new read: the kept letter, no new call.
    again = c.post("/api/reading/digest", json={"kind": "period", "scope": "2026-09", "lang": "ru"}, headers=env.h(env.madik))
    assert again.json()["status"] == "done" and started == [1]
    # A book with nothing written about it has nothing to draw together.
    none = c.post("/api/reading/digest", json={"kind": "book", "scope": _vol_key("Atomic Habits"), "lang": "ru"}, headers=env.h(env.madik))
    assert none.status_code == 400 and none.json()["detail"] == "nothing_to_summarise"
