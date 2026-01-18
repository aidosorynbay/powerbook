from __future__ import annotations

import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.group import Group
from app.models.round import Round
from app.repositories.group_members import GroupMemberRepository
from app.repositories.groups import GroupRepository
from app.repositories.rounds import RoundRepository


class GroupService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.groups = GroupRepository(db)
        self.members = GroupMemberRepository(db)
        self.rounds = RoundRepository(db)

    def get_by_slug(self, *, slug: str) -> Group:
        g = self.groups.get_by_slug(slug)
        if g is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
        return g

    def get(self, *, group_id: uuid.UUID) -> Group:
        g = self.groups.get(group_id)
        if g is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
        return g

    def create(self, *, name: str, slug: str, owner_user_id: uuid.UUID) -> Group:
        existing = self.groups.get_by_slug(slug)
        if existing is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Slug already exists")
        now = datetime.now(tz=ZoneInfo("UTC"))
        # GroupRepository.create() commits; keep a second commit for membership.
        g = self.groups.create(name=name, slug=slug, owner_user_id=owner_user_id)
        if self.members.get_for_user(group_id=g.id, user_id=owner_user_id) is None:
            self.members.create_admin_membership(group_id=g.id, user_id=owner_user_id, joined_at=now)
        self.db.commit()
        self.db.refresh(g)
        return g

    def get_current_round(self, *, group_id: uuid.UUID) -> Round | None:
        # MVP definition: "current round" is the round for the current month (UTC).
        now = datetime.now(tz=ZoneInfo("UTC"))
        return self.rounds.get_by_group_year_month(group_id=group_id, year=now.year, month=now.month)

