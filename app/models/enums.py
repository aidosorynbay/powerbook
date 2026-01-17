from __future__ import annotations

from enum import Enum


class Gender(str, Enum):
    male = "male"
    female = "female"


class SystemRole(str, Enum):
    user = "user"
    admin = "admin"
    superadmin = "superadmin"


class GroupMemberRole(str, Enum):
    admin = "admin"
    member = "member"


class MembershipStatus(str, Enum):
    invited = "invited"
    active = "active"
    removed = "removed"


class RoundStatus(str, Enum):
    draft = "draft"
    registration_open = "registration_open"
    locked = "locked"  # after deadline
    closed = "closed"
    results_published = "results_published"


class RoundParticipantStatus(str, Enum):
    active = "active"
    left_before_deadline = "left_before_deadline"
    locked = "locked"
    penalty_left = "penalty_left"
    removed_by_admin = "removed_by_admin"


class ResultGroup(str, Enum):
    winner = "winner"
    loser = "loser"

