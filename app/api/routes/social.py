from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.schemas.social import BuddyOut, DirectoryEntryOut, PublicProfileOut
from app.services.social import SocialService

router = APIRouter(prefix="/social", tags=["social"])


@router.get("/directory", response_model=list[DirectoryEntryOut])
def get_directory(db: Session = Depends(get_db), _user=Depends(get_current_user)) -> list[DirectoryEntryOut]:
    return SocialService(db).directory()


@router.get("/profile/{user_id}", response_model=PublicProfileOut)
def get_public_profile(
    user_id: uuid.UUID, db: Session = Depends(get_db), user=Depends(get_current_user)
) -> PublicProfileOut:
    return SocialService(db).public_profile(target_user_id=user_id, viewer_id=user.id)


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
