from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import ResultGroup, RoundParticipantStatus, RoundStatus
from app.models.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.group import Group
    from app.models.user import User


class Round(TimestampMixin, Base):
    __tablename__ = "rounds"

    __table_args__ = (
        UniqueConstraint("group_id", "year", "month", name="uq_rounds_group_year_month"),
        CheckConstraint("month >= 1 AND month <= 12", name="ck_rounds_month_range"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    group_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("groups.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(SmallInteger, nullable=False)

    status: Mapped[RoundStatus] = mapped_column(
        Enum(RoundStatus, name="round_status"),
        nullable=False,
        default=RoundStatus.draft,
    )

    registration_open_until_day: Mapped[int] = mapped_column(
        SmallInteger,
        nullable=False,
        default=10,
    )
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="UTC")

    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    group: Mapped["Group"] = relationship(back_populates="rounds")

    participants: Mapped[list["RoundParticipant"]] = relationship(
        back_populates="round",
        cascade="all, delete-orphan",
    )

    reading_logs: Mapped[list["ReadingLog"]] = relationship(
        back_populates="round",
        cascade="all, delete-orphan",
    )

    results: Mapped[list["RoundResult"]] = relationship(
        back_populates="round",
        cascade="all, delete-orphan",
    )

    exchange_pairs: Mapped[list["BookExchangePair"]] = relationship(
        back_populates="round",
        cascade="all, delete-orphan",
    )


class RoundParticipant(TimestampMixin, Base):
    __tablename__ = "round_participants"

    __table_args__ = (
        UniqueConstraint(
            "round_id",
            "user_id",
            name="uq_round_participants_round_user",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    round_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("rounds.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    status: Mapped[RoundParticipantStatus] = mapped_column(
        Enum(RoundParticipantStatus, name="round_participant_status"),
        nullable=False,
        default=RoundParticipantStatus.active,
    )

    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    left_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    round: Mapped["Round"] = relationship(back_populates="participants")
    user: Mapped["User"] = relationship(back_populates="round_participations")


class ReadingLog(TimestampMixin, Base):
    __tablename__ = "reading_logs"

    __table_args__ = (
        UniqueConstraint(
            "round_id",
            "user_id",
            "date",
            name="uq_reading_logs_round_user_date",
        ),
        CheckConstraint("minutes >= 0", name="ck_reading_logs_minutes_non_negative"),
        CheckConstraint("score IN (0, 1)", name="ck_reading_logs_score_0_1"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    round_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("rounds.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    score: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)

    round: Mapped["Round"] = relationship(back_populates="reading_logs")
    user: Mapped["User"] = relationship(back_populates="reading_logs")


class RoundResult(TimestampMixin, Base):
    __tablename__ = "round_results"

    __table_args__ = (
        UniqueConstraint("round_id", "user_id", name="uq_round_results_round_user"),
        CheckConstraint("total_score >= 0", name="ck_round_results_total_score_non_negative"),
        CheckConstraint("rank >= 1", name="ck_round_results_rank_positive"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    round_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("rounds.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    total_score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rank: Mapped[int] = mapped_column(Integer, nullable=False)
    group: Mapped[ResultGroup] = mapped_column(
        Enum(ResultGroup, name="result_group"),
        nullable=False,
    )

    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    round: Mapped["Round"] = relationship(back_populates="results")
    user: Mapped["User"] = relationship(back_populates="round_results")


class BookExchangePair(TimestampMixin, Base):
    """
    Final "who gives a book to whom" pairs for a round.

    We intentionally *do not* model the delivery process in MVP
    (no statuses like given/received yet).
    """

    __tablename__ = "book_exchange_pairs"

    __table_args__ = (
        UniqueConstraint(
            "round_id",
            "giver_user_id",
            name="uq_book_exchange_pairs_round_giver",
        ),
        CheckConstraint(
            "giver_user_id <> receiver_user_id",
            name="ck_book_exchange_pairs_no_self_pair",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    round_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("rounds.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    giver_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    receiver_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    round: Mapped["Round"] = relationship(back_populates="exchange_pairs")
    giver: Mapped["User"] = relationship(
        back_populates="exchange_pairs_given",
        foreign_keys=[giver_user_id],
    )
    receiver: Mapped["User"] = relationship(
        back_populates="exchange_pairs_received",
        foreign_keys=[receiver_user_id],
    )

