from __future__ import annotations

import uuid

import base64
import re

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.schemas.social import BuddyOut, DirectoryEntryOut, PublicProfileOut
from app.services.social import SocialService

router = APIRouter(prefix="/social", tags=["social"])


@router.get("/directory", response_model=list[DirectoryEntryOut])
def get_directory(
    background: BackgroundTasks, db: Session = Depends(get_db), _user=Depends(get_current_user)
) -> list[DirectoryEntryOut]:
    service = SocialService(db)
    out = service.directory()
    if service.pending_lookups:
        # Covers of recent books nobody has looked up yet: there on the next visit.
        from app.services import covers

        background.add_task(covers.fill_in_background, service.pending_lookups)
    return out


@router.get("/profile/{user_id}", response_model=PublicProfileOut)
def get_public_profile(
    user_id: uuid.UUID, background: BackgroundTasks, db: Session = Depends(get_db), user=Depends(get_current_user)
) -> PublicProfileOut:
    service = SocialService(db)
    out = service.public_profile(target_user_id=user_id, viewer_id=user.id)
    if service.pending_lookups:
        # Covers for the top-3 nobody has looked up yet: there on the next visit.
        from app.services import covers

        background.add_task(covers.fill_in_background, service.pending_lookups)
    return out


@router.post("/buddies/{user_id}")
def add_buddy(user_id: uuid.UUID, db: Session = Depends(get_db), user=Depends(get_current_user)) -> dict:
    SocialService(db).add_buddy(user_id=user.id, buddy_user_id=user_id)
    return {"ok": True}


@router.delete("/buddies/{user_id}")
def remove_buddy(user_id: uuid.UUID, db: Session = Depends(get_db), user=Depends(get_current_user)) -> dict:
    SocialService(db).remove_buddy(user_id=user.id, buddy_user_id=user_id)
    return {"ok": True}


@router.get("/buddies/mine", response_model=list[BuddyOut])
def my_buddies(db: Session = Depends(get_db), user=Depends(get_current_user)) -> list[BuddyOut]:
    return SocialService(db).my_buddies(user_id=user.id)


@router.get("/buddies/followers", response_model=list[BuddyOut])
def my_followers(db: Session = Depends(get_db), user=Depends(get_current_user)) -> list[BuddyOut]:
    return SocialService(db).my_followers(user_id=user.id)


_DATA_URL = re.compile(r"^data:(image/[a-z+.-]+);base64,(.+)$", re.S)


@router.get("/avatar/{user_id}")
def get_avatar(user_id: uuid.UUID, db: Session = Depends(get_db)) -> Response:
    """A reader's picture as an image, for lists that show many faces (the circle's readers): the
    leaderboard carries only whether there is one. Public, like the face on a reader's page."""
    from app.models.user import User

    user = db.get(User, user_id)
    m = _DATA_URL.match(user.avatar_data or "") if user else None
    if not m:
        raise HTTPException(status_code=404, detail="No avatar")
    return Response(
        content=base64.b64decode(m.group(2)),
        media_type=m.group(1),
        headers={"Cache-Control": "public, max-age=86400"},
    )
