from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.schemas.groups import CurrentRoundStatusOut, GroupCreateRequest, GroupOut
from app.schemas.rounds import RoundOut
from app.services.groups import GroupService

router = APIRouter(prefix="/groups", tags=["groups"])


@router.get("/by-slug/{slug}", response_model=GroupOut)
def get_group_by_slug(slug: str, db: Session = Depends(get_db), _user=Depends(get_current_user)) -> GroupOut:
    g = GroupService(db).get_by_slug(slug=slug)
    return GroupOut.model_validate(g)


@router.get("/{group_id}", response_model=GroupOut)
def get_group(group_id: uuid.UUID, db: Session = Depends(get_db), _user=Depends(get_current_user)) -> GroupOut:
    g = GroupService(db).get(group_id=group_id)
    return GroupOut.model_validate(g)


@router.get("/{group_id}/current_round", response_model=RoundOut | None)
def get_current_round(
    group_id: uuid.UUID,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
) -> RoundOut | None:
    rnd = GroupService(db).get_current_round(group_id=group_id)
    return RoundOut.model_validate(rnd) if rnd else None


@router.post("", response_model=GroupOut)
def create_group(
    payload: GroupCreateRequest,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> GroupOut:
    g = GroupService(db).create(name=payload.name, slug=payload.slug, owner_user_id=user.id)
    return GroupOut.model_validate(g)


@router.get("/by-slug/{slug}/current-round-status", response_model=CurrentRoundStatusOut)
def get_current_round_status(
    slug: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> CurrentRoundStatusOut:
    """Get current round for a group by slug, including user's participation status."""
    return GroupService(db).get_current_round_status(slug=slug, user_id=user.id)

