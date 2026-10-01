from __future__ import annotations

import calendar
import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    Text,
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

    # Day window inside the month. Regular rounds run the whole month
    # (start_day=1, end_day=NULL meaning "last day"); a mini-round narrows it,
    # e.g. 15..30. Days outside the window score nothing and are not misses.
    start_day: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1)
    end_day: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)

    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="UTC")

    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    @property
    def last_day_num(self) -> int:
        """Last day this round counts — end_day when set, else month end."""
        month_end = calendar.monthrange(self.year, self.month)[1]
        return min(self.end_day, month_end) if self.end_day else month_end

    @property
    def first_day_date(self) -> date:
        return date(self.year, self.month, max(1, self.start_day))

    @property
    def last_day_date(self) -> date:
        return date(self.year, self.month, self.last_day_num)

    @property
    def day_list(self) -> list[date]:
        return [
            date(self.year, self.month, d)
            for d in range(max(1, self.start_day), self.last_day_num + 1)
        ]

    def covers(self, d: date) -> bool:
        return self.first_day_date <= d <= self.last_day_date

    @property
    def is_partial_month(self) -> bool:
        month_end = calendar.monthrange(self.year, self.month)[1]
        return self.start_day > 1 or self.last_day_num < month_end

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

    def __str__(self) -> str:
        return f"{self.year}-{self.month:02d}"


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
    book_finished: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    comment: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    is_comment_private: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")

    round: Mapped["Round"] = relationship(back_populates="reading_logs")
    user: Mapped["User"] = relationship(back_populates="reading_logs")
    books: Mapped[list["ReadingLogBook"]] = relationship(
        back_populates="log",
        cascade="all, delete-orphan",
        order_by="ReadingLogBook.position",
    )


class ReadingLogBook(TimestampMixin, Base):
    """Which book a day's minutes went to.

    Usually one row per day: the book the reader is on. A day read across two
    books splits its minutes («20 мин на эту, 10 на ту»); the day's total stays
    on reading_logs, which the score and the leaderboard read. Summed over a
    title these rows are «сколько минут ушло на эту книгу».
    """

    __tablename__ = "reading_log_books"

    __table_args__ = (
        CheckConstraint("minutes >= 0", name="ck_reading_log_books_minutes_non_negative"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    reading_log_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("reading_logs.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    # The log's reader again, so per-book totals need no join.
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    title_norm: Mapped[str] = mapped_column(String(300), nullable=False)
    minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    finished: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    position: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)

    log: Mapped["ReadingLog"] = relationship(back_populates="books")


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

    giver_marked_given_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    receiver_marked_received_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
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

