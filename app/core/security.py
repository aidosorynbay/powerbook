from __future__ import annotations

from datetime import datetime, timedelta, timezone

import bcrypt
from jose import JWTError, jwt

from app.core.config import settings

def hash_password(password: str) -> str:
    pw = password.encode("utf-8")
    if len(pw) > 72:
        # bcrypt only uses the first 72 bytes; reject longer inputs explicitly.
        raise ValueError("Password must be at most 72 bytes (bcrypt limit).")
    hashed = bcrypt.hashpw(pw, bcrypt.gensalt(rounds=12))
    return hashed.decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    pw = password.encode("utf-8")
    # Avoid 500s from bcrypt on too-long passwords.
    if len(pw) > 72:
        return False
    return bcrypt.checkpw(pw, password_hash.encode("utf-8"))


def create_access_token(*, subject: str, expires_minutes: int | None = None) -> str:
    exp_minutes = expires_minutes if expires_minutes is not None else settings.jwt_access_token_exp_minutes
    now = datetime.now(timezone.utc)
    payload = {
        "sub": subject,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=exp_minutes)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:  # pragma: no cover
        raise ValueError("Invalid token") from exc

