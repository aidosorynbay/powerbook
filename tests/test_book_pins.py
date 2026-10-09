"""One book, one card: a reader's copy pinned to a book of the shared library
(«Какая это книга?»), the founder's links between two books that are one,
and finding a book from a file name."""
from __future__ import annotations

import uuid
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.admin_books import likely_doubles, link
from app.core.security import create_access_token
from app.db.base import Base
from app.db.session import get_db
from app.main import create_app
from app.models.enums import Gender, RoundStatus
from app.models.group import Group
from app.models.library import LibraryBook
from app.models.manual_book import ManualBook
from app.models.round import ReadingLog, Round
from app.models.user import User
from app.services import catalog


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

    def user(name):
        u = User(username=name, display_name=name.title(), password_hash="x", gender=Gender.female)
        db.add(u)
        db.flush()
        return u

    aidos, dana, erlan = user("aidos"), user("dana"), user("erlan")
    group = Group(name="PowerBook", slug="powerbook", owner_user_id=aidos.id)
    db.add(group)
    db.flush()
    rnd = Round(group_id=group.id, year=2026, month=9, status=RoundStatus.locked, end_day=None)
    db.add(rnd)
    db.flush()
    # Aidos brought a file whose name is all he has: a different "book" to the library.
    upload = LibraryBook(user_id=aidos.id, title="Clear_James_-_Atomic_Habits", file_format="epub",
                         file_key=f"{aidos.id}/{uuid.uuid4()}.epub", file_size=10)
    db.add(upload)
    # Dana has the Russian edition on her shelf.
    manual = ManualBook(user_id=dana.id, title="Атомные привычки", title_norm="атомные привычки", author="Джеймс Клир")
    db.add(manual)
    # Erlan read Bulgakov twice, in two languages.
    for day, title in ((3, "Мастер и Маргарита"), (9, "The Master and Margarita")):
        db.add(ReadingLog(round_id=rnd.id, user_id=erlan.id, date=date(2026, 9, day), minutes=40, score=0,
                          comment=title, book_finished=True, is_comment_private=False))
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

    yield type("Env", (), dict(db=db, client=client, h=h, aidos=aidos, dana=dana, erlan=erlan,
                               upload=upload, manual=manual))
    catalog.invalidate()


def _mark(env, user, volume_key, rating):
    r = env.client.put("/api/books/reviews", json={"volume_key": volume_key, "rating": rating, "text": None}, headers=env.h(user))
    assert r.status_code == 200, r.text
    catalog.invalidate()


def test_a_pinned_copy_and_its_mark_count_for_the_one_book(env):
    c = env.client
    _mark(env, env.dana, f"m:{env.manual.id}", 7)
    _mark(env, env.aidos, f"u:{env.upload.id}", 9)
    # Two books with one mark each, before Aidos says which book his file is.
    page = c.get("/api/books/catalog", params={"q": "привычки"}, headers=env.h(env.aidos)).json()
    assert [(i["title"], i["pb_votes"]) for i in page["items"]] == [("Атомные привычки", 1)]

    # «Какая это книга?» finds Dana's book from his file name, and he picks it.
    found = c.get("/api/books/match", params={"q": "Clear_James_-_Atomic_Habits", "editions": "false"}, headers=env.h(env.aidos)).json()
    target = next(w for w in found["works"] if w["title"] == "Атомные привычки")
    r = c.put(f"/api/library/overrides/u:{env.upload.id}/work", json={"work_key": target["key"]}, headers=env.h(env.aidos))
    assert r.status_code == 200, r.text

    work = c.get(f"/api/books/work/{target['key']}", headers=env.h(env.dana)).json()
    assert work["pb_votes"] == 2 and work["pb_rating"] == 8.0

    shelf = c.get("/api/library/bookcase", headers=env.h(env.aidos)).json()["books"]
    mine = next(b for b in shelf if b["key"] == f"u:{env.upload.id}")
    assert mine["pinned"] is True and mine["title"] == "Атомные привычки" and mine["rating"] == 9

    # Taken back: the file is its own book again.
    assert c.delete(f"/api/library/overrides/u:{env.upload.id}/work", headers=env.h(env.aidos)).status_code == 200
    assert c.get(f"/api/books/work/{target['key']}", headers=env.h(env.dana)).json()["pb_votes"] == 1


def test_the_founder_joins_a_translation_and_its_original(env):
    idx = catalog.index(env.db)
    titles = sorted(w.title for w in idx.works.values())
    assert "Мастер и Маргарита" in titles and "The Master and Margarita" in titles

    keys = [w.key for w in idx.works.values() if "aster" in w.title or "Мастер" in w.title]
    assert len(keys) == 2
    assert link(env.db, keys, admin_id=None) == 1
    idx = catalog.index(env.db)
    merged = [w for w in idx.works.values() if "aster" in w.title or "Мастер" in w.title]
    assert len(merged) == 1 and merged[0].finishes == 2

    # Twice is once.
    assert link(env.db, keys, admin_id=None) == 0


def test_likely_doubles_pair_the_same_author_and_a_longer_title(env):
    db = env.db
    db.add(ManualBook(user_id=env.erlan.id, title="Атомные привычки. Как приобрести хорошие привычки", title_norm="x", author="Джеймс Клир"))
    db.commit()
    catalog.invalidate()
    idx = catalog.index(db)
    pairs = likely_doubles(idx, {})
    titles = {frozenset((a["title"], b["title"])) for a, b in pairs}
    assert frozenset(("Атомные привычки", "Атомные привычки. Как приобрести хорошие привычки")) in titles or len(
        [w for w in idx.works.values() if w.title.startswith("Атомные")]
    ) == 1


def test_a_copy_pinned_to_a_book_does_not_rename_it(env):
    """«Граф Монте-Кристо 2» said to be «Граф Монте-Кристо»: one book, under
    the name it already had, though the copy and its mark outnumber it."""
    c = env.client
    env.db.add(ManualBook(user_id=env.dana.id, title="Граф Монте-Кристо", title_norm="граф монте-кристо", author="Александр Дюма"))
    mine = ManualBook(user_id=env.erlan.id, title="Граф Монте-Кристо 2", title_norm="граф монте-кристо 2")
    env.db.add(mine)
    env.db.commit()
    catalog.invalidate()
    _mark(env, env.erlan, f"m:{mine.id}", 10)

    r = c.put(f"/api/library/overrides/m:{mine.id}/work", json={"work_key": "grafmontekristo"}, headers=env.h(env.erlan))
    assert r.status_code == 200, r.text
    found = c.get("/api/books/match", params={"q": "Граф Монте-Кристо", "editions": "false"}, headers=env.h(env.erlan)).json()
    assert [(w["key"], w["title"], w["readers"]) for w in found["works"]] == [("grafmontekristo", "Граф Монте-Кристо", 2)]
    assert found["works"][0]["pb_rating"] == 10


def test_a_change_in_one_server_process_reaches_the_other(env, monkeypatch, tmp_path):
    monkeypatch.setattr(catalog, "_STAMP", str(tmp_path / "stamp"))
    catalog.invalidate()
    first = catalog.index(env.db)
    assert catalog.index(env.db) is first
    # The other process said something changed: the copy here is built again.
    import os
    import time

    later = time.time() + 5
    os.utime(tmp_path / "stamp", (later, later))
    assert catalog.index(env.db) is not first
