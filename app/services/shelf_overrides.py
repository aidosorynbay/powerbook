"""A reader's corrections to the books on their own shelf.

The cover lookup is a good guess, not the last word. Here a reader fixes a
title or an author, picks another edition's cover, photographs their own
copy, or asks for the painted edition instead. Every change is theirs
alone: it shows on their shelf (to them and to anyone visiting it) and
leaves everyone else's copy of the same book as it was.
"""
from __future__ import annotations

import re
import uuid
from urllib.parse import quote

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.shelf_override import ShelfOverride
from app.services import covers

VOLUME_KEY = re.compile(r"^[rmul]:[0-9a-f-]{6,40}$")
MAX_PHOTO_BYTES = 3 * 1024 * 1024


def _bad(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def _check_key(volume_key: str) -> str:
    if not VOLUME_KEY.match(volume_key):
        raise _bad("bad_volume")
    return volume_key


def overrides_for(db: Session, user_id: uuid.UUID) -> dict[str, ShelfOverride]:
    rows = db.execute(select(ShelfOverride).where(ShelfOverride.user_id == user_id)).scalars().all()
    return {row.volume_key: row for row in rows}


def _row(db: Session, user_id: uuid.UUID, volume_key: str) -> ShelfOverride:
    row = db.get(ShelfOverride, (user_id, _check_key(volume_key)))
    if row is None:
        row = ShelfOverride(user_id=user_id, volume_key=volume_key, cover_mode="auto")
        db.add(row)
    return row


def _drop_image(row: ShelfOverride) -> None:
    # Only pictures stored for this override are ever removed; the shared
    # cover cache keeps its own files.
    if row.image:
        covers.delete_image(row.image)
    row.image = row.source = row.source_id = None


def _tidy(db: Session, row: ShelfOverride) -> None:
    """An override that overrides nothing is just a row; don't keep it."""
    if row.cover_mode == "auto" and not row.title and not row.author and not row.work_key and not row.hidden:
        _drop_image(row)
        db.delete(row)


def set_text(db: Session, user_id: uuid.UUID, volume_key: str, title: str | None, author: str | None) -> None:
    row = _row(db, user_id, volume_key)
    row.title = (title or "").strip()[:300] or None
    row.author = (author or "").strip()[:200] or None
    _tidy(db, row)
    db.commit()


def set_mode(db: Session, user_id: uuid.UUID, volume_key: str, mode: str) -> None:
    """"auto" returns the book to whatever the lookup found; "none" asks for
    the painted edition."""
    if mode not in ("auto", "none"):
        raise _bad("bad_mode")
    row = _row(db, user_id, volume_key)
    _drop_image(row)
    row.cover_mode = mode
    _tidy(db, row)
    db.commit()


def pick(db: Session, user_id: uuid.UUID, volume_key: str, source: str, volume_id: str) -> None:
    """Use the cover of an edition the reader chose from search results."""
    if source not in ("google", "openlibrary") or not re.match(r"^[\w-]{1,40}$", volume_id):
        raise _bad("bad_edition")
    images = covers.fetch_edition_images(source, volume_id)
    if images is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="no_cover")
    row = _row(db, user_id, volume_key)
    _drop_image(row)
    row.image = covers.store_images(images)
    row.cover_mode = "image"
    row.source, row.source_id = source, volume_id
    db.commit()


async def upload_photo(
    db: Session, user_id: uuid.UUID, volume_key: str, photo: UploadFile, thumb: UploadFile | None
) -> None:
    """A photo of the reader's own copy. The browser has already scaled it
    down to a JPEG; here it only has to prove it is one, and not a huge one."""
    full = await photo.read(MAX_PHOTO_BYTES + 1)
    small = await thumb.read(MAX_PHOTO_BYTES + 1) if thumb else full
    for data in (full, small):
        size = covers.jpeg_size(data)
        if len(data) > MAX_PHOTO_BYTES or not size or size[0] < 60 or size[1] < 60:
            raise _bad("bad_photo")
    row = _row(db, user_id, volume_key)
    _drop_image(row)
    row.image = covers.store_images((full, small))
    row.cover_mode = "image"
    row.source = "photo"
    row.source_id = None
    db.commit()


def reset(db: Session, user_id: uuid.UUID, volume_key: str) -> None:
    row = db.get(ShelfOverride, (user_id, _check_key(volume_key)))
    if row is not None:
        _drop_image(row)
        db.delete(row)
        db.commit()


def search_editions(query: str) -> list[dict]:
    """Editions to choose a cover from — the reader decides which is right,
    so nothing is judged here beyond leaving out summaries and coverless
    records."""
    query = query.strip()[:200]
    if len(query) < 2:
        return []
    results = []
    seen = set()
    for candidate in covers.search_any(query):
        if not candidate.has_thumbnail or covers.is_derivative(candidate) or candidate.volume_id in seen:
            continue
        seen.add(candidate.volume_id)
        if candidate.source == "openlibrary":
            thumb = f"https://covers.openlibrary.org/b/id/{quote(candidate.volume_id)}-M.jpg"
        else:
            thumb = (
                f"https://books.google.com/books/content?id={quote(candidate.volume_id)}"
                "&printsec=frontcover&img=1&zoom=1&source=gbs_api"
            )
        results.append(
            {
                "source": candidate.source,
                "volume_id": candidate.volume_id,
                "title": candidate.titles[0],
                "author": (candidate.creators or [None])[0],
                "thumb_url": thumb,
            }
        )
        if len(results) >= 18:
            break
    return results


def pin_work(
    db: Session,
    user_id: uuid.UUID,
    volume_key: str,
    *,
    work_key: str | None = None,
    source: str | None = None,
    volume_id: str | None = None,
    title: str | None = None,
    author: str | None = None,
) -> str:
    """«Какая это книга?»: the reader says which book their copy is.

    Either a book of the shared library (work_key), whose title and author
    the copy takes, or a catalogue edition (source + volume_id), whose
    title, author and cover it takes. From then on the copy and its mark
    count for that book, whatever the file or the edition was called.
    Returns the key the copy is pinned to.
    """
    from app.core.booktitles import canonical_key
    from app.services import catalog

    if work_key:
        work = catalog.index(db).find(work_key)
        if work is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="book_not_found")
        row = _row(db, user_id, volume_key)
        row.work_key = work.key
        row.title = work.title[:300]
        row.author = (work.author or "")[:200] or None
    elif source and volume_id and title:
        try:
            pick(db, user_id, volume_key, source, volume_id)
        except HTTPException as exc:
            # An edition without a cover is still the right book.
            if exc.detail != "no_cover":
                raise
        row = _row(db, user_id, volume_key)
        key = canonical_key(covers.clean_title(title) or title)
        if not key:
            raise _bad("no_title")
        row.work_key = key
        row.title = title.strip()[:300]
        row.author = (author or "").strip()[:200] or None
        row.source, row.source_id = source, volume_id
    else:
        raise _bad("bad_pick")
    db.commit()
    catalog.invalidate()
    return row.work_key


def unpin_work(db: Session, user_id: uuid.UUID, volume_key: str) -> None:
    from app.services import catalog

    row = db.get(ShelfOverride, (user_id, _check_key(volume_key)))
    if row is None or not row.work_key:
        return
    row.work_key = None
    _tidy(db, row)
    db.commit()
    catalog.invalidate()


def set_hidden(db: Session, user_id: uuid.UUID, volume_key: str, hidden: bool) -> None:
    """«Убрать с полки» / «Вернуть»: the volume stays out of the shelf and the shared library, or comes back."""
    from app.services import catalog

    row = _row(db, user_id, volume_key)
    row.hidden = hidden
    if not hidden:
        _tidy(db, row)
    db.commit()
    catalog.invalidate()
