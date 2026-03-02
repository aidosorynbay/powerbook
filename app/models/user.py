from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Enum, String, Uuid
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

    telegram_id: Mapped[str | None] = mapped_column(String(120), nullable=True, default=None)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

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

