from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.enums import GroupMemberRole, MembershipStatus
from app.models.group import GroupMember
from app.repositories.base import BaseRepository


class GroupMemberRepository(BaseRepository[GroupMember]):
    def __init__(self, db: Session) -> None:
        super().__init__(db)

    def get_for_user(self, *, group_id: uuid.UUID, user_id: uuid.UUID) -> GroupMember | None:
        stmt = select(GroupMember).where(GroupMember.group_id == group_id, GroupMember.user_id == user_id)
        return self.db.execute(stmt).scalar_one_or_none()

    def create_admin_membership(self, *, group_id: uuid.UUID, user_id: uuid.UUID, joined_at: datetime) -> GroupMember:
        m = GroupMember(
            group_id=group_id,
            user_id=user_id,
            role=GroupMemberRole.admin,
            status=MembershipStatus.active,
            joined_at=joined_at,
        )
        self.db.add(m)
        self.db.flush()
        return m

