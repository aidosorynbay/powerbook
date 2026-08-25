from __future__ import annotations

import shutil
import uuid
from pathlib import Path
from typing import BinaryIO

from app.core.config import settings

# Books are plain files on disk rather than rows in Postgres: a 30 MB PDF has
# no business in a database that is otherwise 34 MB total. The directory is
# bind-mounted into the container so a rebuild doesn't take the library with
# it, and it sits outside anything nginx serves — every read goes through an
# authenticated route so the owner check can't be skipped by guessing a URL.
STORAGE_ROOT = Path(settings.library_storage_dir)

ALLOWED_FORMATS = {"pdf", "epub"}


def _user_dir(user_id: uuid.UUID) -> Path:
    return STORAGE_ROOT / str(user_id)


def build_key(*, user_id: uuid.UUID, book_id: uuid.UUID, file_format: str) -> str:
    """Storage key for a book. Derived entirely from ids we generated — the
    uploader's filename never reaches the filesystem, so there is nothing to
    sanitise and no path to traverse."""
    return f"{user_id}/{book_id}.{file_format}"


def resolve(file_key: str) -> Path:
    path = (STORAGE_ROOT / file_key).resolve()
    # Belt and braces: even though keys are generated, refuse anything that
    # resolves outside the storage root.
    if not str(path).startswith(str(STORAGE_ROOT.resolve())):
        raise ValueError("Invalid storage key")
    return path


def save(*, user_id: uuid.UUID, file_key: str, source: BinaryIO) -> int:
    _user_dir(user_id).mkdir(parents=True, exist_ok=True)
    path = resolve(file_key)
    with path.open("wb") as target:
        shutil.copyfileobj(source, target)
    return path.stat().st_size


def delete(file_key: str) -> None:
    try:
        resolve(file_key).unlink(missing_ok=True)
    except (ValueError, OSError):
        # A missing or unreadable file shouldn't block deleting the row —
        # the row is what the reader sees.
        pass


def used_bytes(user_id: uuid.UUID) -> int:
    directory = _user_dir(user_id)
    if not directory.exists():
        return 0
    return sum(f.stat().st_size for f in directory.iterdir() if f.is_file())
