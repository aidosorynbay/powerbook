"""A sign-in lasts while PowerBook is used: tokens live 400 days, the app swaps them daily through /auth/refresh,
and only «Выйти» or a new password ends a session (2026-10-15: 36 of 69 returning members met «Вход» in two weeks
when a token lived 7 days)."""
from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient
from jose import jwt
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.core.config import settings
from app.core.security import create_access_token, hash_password
from app.db.base import Base
from app.db.session import get_db
from app.main import create_app
from app.models.enums import Gender
from app.models.user import User


@pytest.fixture()
def env():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    db = Session()
    user = User(username="reader", display_name="Reader", password_hash=hash_password("old-pass-1"), gender=Gender.female, telegram_id="reader")
    db.add(user)
    db.commit()
    app = create_app()

    def _db():
        yield db

    app.dependency_overrides[get_db] = _db
    yield TestClient(app), db, user
    db.close()


def claims(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_login_token_lasts_and_refresh_renews_it(env):
    client, _db, _user = env
    res = client.post("/api/auth/login", json={"login": "reader", "password": "old-pass-1"})
    assert res.status_code == 200
    token = res.json()["access_token"]
    c = claims(token)
    assert c["exp"] - c["iat"] >= 399 * 24 * 3600  # months, not a week
    assert c["pv"]
    time.sleep(1)  # a later iat
    fresh = client.post("/api/auth/refresh", headers=bearer(token))
    assert fresh.status_code == 200
    new = fresh.json()["access_token"]
    assert claims(new)["iat"] > c["iat"]
    assert client.get("/api/auth/me", headers=bearer(new)).status_code == 200


def test_new_password_ends_other_sessions_but_keeps_this_one(env):
    client, _db, _user = env
    other_device = client.post("/api/auth/login", json={"login": "reader", "password": "old-pass-1"}).json()["access_token"]
    this_device = client.post("/api/auth/login", json={"login": "reader", "password": "old-pass-1"}).json()["access_token"]
    res = client.put("/api/auth/change-password", headers=bearer(this_device),
                     json={"current_password": "old-pass-1", "new_password": "new-pass-2"})
    assert res.status_code == 200
    kept = res.json()["access_token"]
    assert client.get("/api/auth/me", headers=bearer(other_device)).status_code == 401
    assert client.get("/api/auth/me", headers=bearer(this_device)).status_code == 401
    assert client.get("/api/auth/me", headers=bearer(kept)).status_code == 200


def test_a_token_from_before_the_fingerprint_still_works(env):
    client, _db, user = env
    legacy = create_access_token(subject=str(user.id), expires_minutes=60)  # no "pv", like every token signed before today
    assert "pv" not in claims(legacy)
    assert client.get("/api/auth/me", headers=bearer(legacy)).status_code == 200
    renewed = client.post("/api/auth/refresh", headers=bearer(legacy))
    assert renewed.status_code == 200 and claims(renewed.json()["access_token"])["pv"]
