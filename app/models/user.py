from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import JSON, Boolean, Enum, ForeignKey, String, Text, Uuid, func
from sqlalchemy.ext.hybrid import hybrid_property
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
    # Archive accounts that are the same human share a person_id. The circles
    # ran in spreadsheets for years and one reader was often written down
    # several ways ("Saira", "Saira khanym", "Saira khnm"). NULL = stands alone.
    person_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), nullable=True, index=True, default=None
    )

    is_claimable: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")

    # An archive account's old Telegram nickname. Not telegram_id: nobody has
    # shown it is theirs, and holding the unique column locked the real owner
    # out of registering. Only a label to match claims by; never unique.
    archive_nick: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True, default=None)

    @hybrid_property
    def telegram_handle(self) -> str | None:
        """The @handle to show next to a name: the account's Telegram, or the
        archive's old nickname for a reader who has not signed up."""
        return self.telegram_id or self.archive_nick

    @telegram_handle.inplace.expression
    @classmethod
    def _telegram_handle_expression(cls):
        return func.coalesce(cls.telegram_id, cls.archive_nick)

    # Social profile extras
    avatar_data: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    recommendation_text: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    reading_music_url: Mapped[str | None] = mapped_column(String(500), nullable=True, default=None)

    # Up to 3 titles the user picks themselves — may include books read outside
    # PowerBook circles, unlike the auto-derived bookshelf from reading_logs.
    favorite_books: Mapped[list[str] | None] = mapped_column(JSON, nullable=True, default=None)

    # Who brought this reader to PowerBook: the member whose shared link they
    # signed up from (a day they shared, or an invitation). NULL when nobody did.
    invited_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, default=None
    )

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

    def __str__(self) -> str:
        # How the admin names a reader: the username, and the Telegram handle when it differs.
        handle = self.telegram_handle
        tg = f" · tg @{handle}" if handle and handle != self.username else ""
        return f"@{self.username}{tg}"
