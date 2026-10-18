"""A reader's public page (/readers/<id>) must build for anyone, with or without awards."""
from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.models.enums import Gender
from app.models.user import User
from app.services.social import SocialService


def test_public_profile_builds():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    a = User(username="a", display_name="A", password_hash="x", gender=Gender.male)
    b = User(username="b", display_name="B", password_hash="x", gender=Gender.female)
    db.add_all([a, b])
    db.flush()
    out = SocialService(db).public_profile(target_user_id=b.id, viewer_id=a.id)
    assert out.username == "b"
