from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import JSON, Boolean, Enum, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import Gender, SystemRole
from app.models.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.group import GroupMember
    from app.models.round import BookExchangePair, ReadingLog, RoundParticipant, RoundResult


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    username: Mapped[str] = mapped_column(String(60), unique=True, index=True, nullable=False)
    email: Mapped[str | None] = mapped_column(String(320), unique=True, index=True, nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)

    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    gender: Mapped[Gender | None] = mapped_column(
        Enum(Gender, name="gender"),
        nullable=False,
    )

    system_role: Mapped[SystemRole] = mapped_column(
        Enum(SystemRole, name="system_role"),
        nullable=False,
        default=SystemRole.user,
    )

    telegram_id: Mapped[str | None] = mapped_column(String(120), unique=True, nullable=True, default=None)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # True for placeholder accounts created by the historical archive import
    # (old circle usernames that couldn't be matched to a real registration).
    # Real users can claim these via /claims to fold that history into their profile.
    is_claimable: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")

    # Social profile extras
    avatar_data: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    recommendation_text: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    reading_music_url: Mapped[str | None] = mapped_column(String(500), nullable=True, default=None)

    # Up to 3 titles the user picks themselves — may include books read outside
    # PowerBook circles, unlike the auto-derived bookshelf from reading_logs.
    favorite_books: Mapped[list[str] | None] = mapped_column(JSON, nullable=True, default=None)

    group_memberships: Mapped[list["GroupMember"]] = relationship(
        back_populates="user",
        foreign_keys="GroupMember.user_id",
        cascade="all, delete-orphan",
    )

    round_participations: Mapped[list["RoundParticipant"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )

    reading_logs: Mapped[list["ReadingLog"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )

    round_results: Mapped[list["RoundResult"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )

    exchange_pairs_given: Mapped[list["BookExchangePair"]] = relationship(
        back_populates="giver",
        foreign_keys="BookExchangePair.giver_user_id",
        cascade="all, delete-orphan",
    )

    exchange_pairs_received: Mapped[list["BookExchangePair"]] = relationship(
        back_populates="receiver",
        foreign_keys="BookExchangePair.receiver_user_id",
        cascade="all, delete-orphan",
    )
