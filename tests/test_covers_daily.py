"""The daily pass: books still without a picture are asked again, a bounded number per day."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.models.book_cover import BookCover
from app.services import covers


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine, tables=[BookCover.__table__])
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def _row(db, key, status, *, image=None, hours_ago=48):
    checked = datetime.now(timezone.utc) - timedelta(hours=hours_ago)
    db.add(BookCover(key=key, query=key.upper(), status=status, image=image, checked_at=checked, attempts=1))
    db.commit()


def test_only_titles_without_a_picture_are_due_and_the_oldest_first(db):
    _row(db, "old-none", "none", hours_ago=72)
    _row(db, "newer-error", "error", hours_ago=30)
    _row(db, "found-no-image", "found", image=None, hours_ago=50)
    _row(db, "has-cover", "found", image="a" * 32, hours_ago=100)
    _row(db, "tried-today", "none", hours_ago=2)
    _row(db, "cut-short", "pending", hours_ago=40)
    due = covers.due_again(db, limit=10)
    assert set(due) == {"old-none", "newer-error", "found-no-image", "cut-short"}
    assert list(due)[0] == "old-none"
    assert db.get(BookCover, "old-none").status == "pending"
    assert db.get(BookCover, "has-cover").status == "found"


def test_the_limit_bounds_the_day(db):
    for i in range(5):
        _row(db, f"t{i}", "none", hours_ago=48 + i)
    assert len(covers.due_again(db, limit=2)) == 2


def test_the_daily_pass_asks_what_is_due(db, monkeypatch, tmp_path):
    _row(db, "gauhar", "none", hours_ago=48)
    asked = {}

    def fake_fill(session, wanted, limit=30):
        asked.update(wanted)
        return 1, 0

    monkeypatch.setattr(covers, "_DAILY_LOCK", tmp_path / "lock")
    monkeypatch.setattr(covers, "fill", fake_fill)
    monkeypatch.setattr("app.db.session.get_session_factory", lambda: (lambda: db))
    covers.scheduled()
    assert list(asked) == ["gauhar"]
