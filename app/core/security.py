from __future__ import annotations

import hashlib
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


def password_fingerprint(password_hash: str) -> str:
    """A short mark of the current password, kept inside the token: once the password changes (or is reset through
    Telegram, or the account is deleted) every token signed before no longer matches, so other devices are signed out."""
    return hashlib.sha256((password_hash or "").encode("utf-8")).hexdigest()[:12]


def create_access_token(*, subject: str, password_hash: str | None = None, expires_minutes: int | None = None) -> str:
    if expires_minutes is None:
        expires_minutes = max(settings.jwt_access_token_exp_minutes, settings.jwt_session_days * 24 * 60)
    now = datetime.now(timezone.utc)
    payload = {
        "sub": subject,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=expires_minutes)).timestamp()),
    }
    if password_hash is not None:
        payload["pv"] = password_fingerprint(password_hash)
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def token_matches_password(payload: dict, password_hash: str) -> bool:
    """Tokens from before the fingerprint have no "pv": they stay valid until the app renews them."""
    pv = payload.get("pv")
    return pv is None or pv == password_fingerprint(password_hash)


def decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:  # pragma: no cover
        raise ValueError("Invalid token") from exc

