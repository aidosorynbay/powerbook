from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.books import NotificationOut, NotificationSettingsIn, NotificationsReadIn
from app.services import notify

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=list[NotificationOut])
def recent(
    limit: int = Query(default=30, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[NotificationOut]:
    """The header bell: newest first."""
    return [NotificationOut(**n) for n in notify.recent(db, user.id, limit=limit)]


@router.get("/unread-count")
def unread_count(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    return {"count": notify.unread_count(db, user.id)}


@router.post("/read")
def mark_read(payload: NotificationsReadIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    """Mark the given ones read, or all of them."""
    notify.mark_read(db, user.id, payload.ids)
    return {"ok": True}


@router.get("/settings")
def settings(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict[str, bool]:
    """What the reader wants to hear about, kind by kind (on unless switched off)."""
    return notify.settings(db, user.id)


@router.put("/settings")
def save_settings(
    payload: NotificationSettingsIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> dict[str, bool]:
    return notify.save_settings(db, user.id, payload.settings)
