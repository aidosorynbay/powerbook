from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.push import ReminderIn, ReminderOut, SubscribeIn, UnsubscribeIn
from app.services import push

router = APIRouter(prefix="/push", tags=["push"])


@router.get("/vapid-public-key")
def vapid_public_key(db: Session = Depends(get_db)) -> dict:
    """The key the browser needs to subscribe; public by nature."""
    return {"key": push.public_key(db)}


@router.post("/subscribe")
def subscribe(payload: SubscribeIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    push.subscribe(
        db,
        user,
        endpoint=payload.subscription.endpoint,
        p256dh=payload.subscription.keys.p256dh,
        auth=payload.subscription.keys.auth,
        user_agent=payload.user_agent,
        display_mode=payload.display_mode,
    )
    return {"ok": True}


@router.post("/unsubscribe")
def unsubscribe(payload: UnsubscribeIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    return {"ok": push.unsubscribe(db, user, payload.endpoint)}


@router.get("/reminder", response_model=ReminderOut)
def reminder(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> ReminderOut:
    return ReminderOut(**push.reminder_state(db, user.id))


@router.put("/reminder", response_model=ReminderOut)
def save_reminder(payload: ReminderIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> ReminderOut:
    return ReminderOut(
        **push.save_reminder(
            db, user, enabled=payload.enabled, hour=payload.hour, minute=payload.minute, tz=payload.tz, locale=payload.locale
        )
    )


@router.post("/test")
def send_test(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    """A push right now, so the reader sees what a reminder looks like."""
    state = push.reminder_state(db, user.id)
    return {"sent": push.send_to_user(db, user.id, push.test_message(state["locale"]))}
