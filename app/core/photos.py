"""Photos readers attach: a copy put up for sale, a book received in the
exchange. The page shrinks them first, so each is a JPEG of a few hundred
KB, kept in the database as a data URL; there are too few to want a
second storage path.
"""
from __future__ import annotations

import base64
import re

from fastapi import HTTPException, status

DATA_URL = re.compile(r"^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$")
MAX_PHOTO_BYTES = 600_000


def _bad(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def check_photo(photo: str | None, *, max_bytes: int = MAX_PHOTO_BYTES) -> str | None:
    """The photo as sent, once it is a real image of a sane size; None for none."""
    if not photo:
        return None
    m = DATA_URL.match(photo)
    if not m:
        raise _bad("bad_photo") from None
    try:
        raw = base64.b64decode(m.group(2), validate=True)
    except ValueError:
        raise _bad("bad_photo") from None
    if len(raw) > max_bytes:
        raise _bad("photo_too_large")
    return photo


def decode_photo(photo: str | None) -> tuple[bytes, str] | None:
    """Bytes and media type of a stored photo, for serving it as an image."""
    m = DATA_URL.match(photo or "")
    if not m:
        return None
    return base64.b64decode(m.group(2)), f"image/{m.group(1)}"
