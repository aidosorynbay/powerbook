from __future__ import annotations

import hmac

from fastapi import APIRouter, Body, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.services import admin_ping

router = APIRouter(prefix="/telegram", tags=["telegram"])


@router.post("/webhook")
def webhook(
    update: dict = Body(...),
    db: Session = Depends(get_db),
    secret: str = Header("", alias="X-Telegram-Bot-Api-Secret-Token"),
) -> dict:
    """The bot's buttons («Одобрить» / «Отказать»), app/services/admin_ping.py."""
    if not settings.telegram_bot_token or not hmac.compare_digest(secret, admin_ping.webhook_secret()):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)
    admin_ping.on_update(db, update)
    return {"ok": True}
