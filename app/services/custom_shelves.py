"""A reader's own shelves in their bookcase and where each book stands.

Only the owner writes; anyone who may see the bookcase sees how it is
arranged, since the shelves are part of how the bookcase looks.
"""

from __future__ import annotations

import uuid

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.custom_shelf import CustomShelf, ShelfPlacement
from app.services.shelf_overrides import VOLUME_KEY

MAX_SHELVES = 12
MAX_NAME = 60


def _bad(detail: str, code: int = status.HTTP_400_BAD_REQUEST) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


def _name(name: str) -> str:
    cleaned = " ".join((name or "").split())
    if not cleaned:
        raise _bad("empty_name")
    return cleaned[:MAX_NAME]


def shelves_for(db: Session, user_id: uuid.UUID) -> list[CustomShelf]:
    return list(
        db.execute(
            select(CustomShelf).where(CustomShelf.user_id == user_id).order_by(CustomShelf.position, CustomShelf.created_at)
        ).scalars()
    )


def placements_for(db: Session, user_id: uuid.UUID) -> dict[str, uuid.UUID]:
    rows = db.execute(select(ShelfPlacement).where(ShelfPlacement.user_id == user_id)).scalars()
    return {row.volume_key: row.shelf_id for row in rows}


def _own(db: Session, user_id: uuid.UUID, shelf_id: uuid.UUID) -> CustomShelf:
    shelf = db.get(CustomShelf, shelf_id)
    if shelf is None or shelf.user_id != user_id:
        raise _bad("shelf_not_found", status.HTTP_404_NOT_FOUND)
    return shelf


def create(db: Session, user_id: uuid.UUID, name: str) -> CustomShelf:
    shelves = shelves_for(db, user_id)
    if len(shelves) >= MAX_SHELVES:
        raise _bad("too_many_shelves")
    shelf = CustomShelf(user_id=user_id, name=_name(name), position=(shelves[-1].position + 1) if shelves else 0)
    db.add(shelf)
    db.commit()
    db.refresh(shelf)
    return shelf


def rename(db: Session, user_id: uuid.UUID, shelf_id: uuid.UUID, name: str) -> CustomShelf:
    shelf = _own(db, user_id, shelf_id)
    shelf.name = _name(name)
    db.commit()
    db.refresh(shelf)
    return shelf


def remove(db: Session, user_id: uuid.UUID, shelf_id: uuid.UUID) -> None:
    shelf = _own(db, user_id, shelf_id)
    # Its books go back to unsorted; the foreign key would cascade too, but
    # not every database here enforces it.
    db.execute(delete(ShelfPlacement).where(ShelfPlacement.shelf_id == shelf.id))
    db.delete(shelf)
    db.commit()


def reorder(db: Session, user_id: uuid.UUID, ids: list[uuid.UUID]) -> list[CustomShelf]:
    shelves = {s.id: s for s in shelves_for(db, user_id)}
    if set(ids) != set(shelves) or len(ids) != len(shelves):
        raise _bad("bad_order")
    for position, shelf_id in enumerate(ids):
        shelves[shelf_id].position = position
    db.commit()
    return shelves_for(db, user_id)


def place(db: Session, user_id: uuid.UUID, volume_key: str, shelf_id: uuid.UUID | None) -> None:
    if not VOLUME_KEY.match(volume_key):
        raise _bad("bad_volume")
    row = db.get(ShelfPlacement, (user_id, volume_key))
    if shelf_id is None:
        if row is not None:
            db.delete(row)
            db.commit()
        return
    _own(db, user_id, shelf_id)
    if row is None:
        db.add(ShelfPlacement(user_id=user_id, volume_key=volume_key, shelf_id=shelf_id))
    else:
        row.shelf_id = shelf_id
    db.commit()
