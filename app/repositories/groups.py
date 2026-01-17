from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.group import Group
from app.repositories.base import BaseRepository


class GroupRepository(BaseRepository[Group]):
    def __init__(self, db: Session) -> None:
        super().__init__(db)

    def get(self, group_id: uuid.UUID) -> Group | None:
        return self.db.get(Group, group_id)

    def get_by_slug(self, slug: str) -> Group | None:
        stmt = select(Group).where(Group.slug == slug)
        return self.db.execute(stmt).scalar_one_or_none()

    def list(self, *, offset: int = 0, limit: int = 50) -> list[Group]:
        stmt = select(Group).offset(offset).limit(limit).order_by(Group.created_at.desc())
        return list(self.db.execute(stmt).scalars().all())

    def create(
        self,
        *,
        name: str,
        slug: str,
        owner_user_id: uuid.UUID,
    ) -> Group:
        group = Group(name=name, slug=slug, owner_user_id=owner_user_id)
        self.db.add(group)
        self.db.commit()
        self.db.refresh(group)
        return group

