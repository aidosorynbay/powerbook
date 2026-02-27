from __future__ import annotations

import calendar
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.group import Group
from app.models.round import Round
from app.repositories.group_members import GroupMemberRepository
from app.repositories.groups import GroupRepository
from app.repositories.participants import RoundParticipantRepository
from app.repositories.rounds import RoundRepository
from app.schemas.groups import CurrentRoundStatusOut, ParticipationInfo, RoundInfo


class GroupService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.groups = GroupRepository(db)
        self.members = GroupMemberRepository(db)
        self.rounds = RoundRepository(db)
        self.participants = RoundParticipantRepository(db)

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

    def get_current_round_status(self, *, slug: str, user_id: uuid.UUID) -> CurrentRoundStatusOut:
        """Get current round for a group by slug, including user's participation status."""
        group = self.get_by_slug(slug=slug)
        rnd = self.get_current_round(group_id=group.id)

        round_info: RoundInfo | None = None
        participation: ParticipationInfo | None = None

        if rnd is not None:
            round_info = RoundInfo.model_validate(rnd)
            participant = self.participants.get_for_user(round_id=rnd.id, user_id=user_id)
            if participant is not None:
                participation = ParticipationInfo(
                    is_participant=True,
                    status=participant.status,
                    joined_at=participant.joined_at,
                )
            else:
                participation = ParticipationInfo(is_participant=False)

        tz = ZoneInfo("Asia/Almaty")  # GMT+5

        deadline_utc: str | None = None
        correction_deadline_utc: str | None = None
        next_round_info: RoundInfo | None = None

        if rnd is not None:
            last_day = calendar.monthrange(rnd.year, rnd.month)[1]

            # Midnight GMT+5 at end of last day = start of next day
            if rnd.month == 12:
                deadline_local = datetime(rnd.year + 1, 1, 1, tzinfo=tz)
            else:
                deadline_local = datetime(rnd.year, rnd.month + 1, 1, tzinfo=tz)
            deadline_utc = deadline_local.astimezone(ZoneInfo("UTC")).isoformat()

            # Correction deadline: 8 PM GMT+5 on last day
            correction_local = datetime(rnd.year, rnd.month, last_day, 20, 0, 0, tzinfo=tz)
            correction_deadline_utc = correction_local.astimezone(ZoneInfo("UTC")).isoformat()

            # Next month's round
            next_year = rnd.year + 1 if rnd.month == 12 else rnd.year
            next_month = 1 if rnd.month == 12 else rnd.month + 1
            next_rnd = self.rounds.get_by_group_year_month(
                group_id=group.id, year=next_year, month=next_month,
            )
            if next_rnd is not None:
                next_round_info = RoundInfo.model_validate(next_rnd)

        return CurrentRoundStatusOut(
            group_id=group.id,
            group_name=group.name,
            round=round_info,
            participation=participation,
            deadline_utc=deadline_utc,
            correction_deadline_utc=correction_deadline_utc,
            next_round=next_round_info,
        )

