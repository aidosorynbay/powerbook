from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, SmallInteger, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import TimestampMixin


class ClanWar(TimestampMixin, Base):
    """«Битва кланов»: a 14-day race between two teams, beside the circle.

    Readers sign up, the founder splits them into two teams, and every day of
    30+ minutes (the circle's own count) strikes the other team's fortress; a
    day when 80% of a team read raises its shield. Anyone may watch; only team
    totals are public. Nothing here changes the circle's table or points.
    """

    __tablename__ = "clan_wars"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    # signup → live (teams split) → done
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="signup")
    prize: Mapped[str | None] = mapped_column(Text, nullable=True)
    split_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ClanWarMember(TimestampMixin, Base):
    __tablename__ = "clan_war_members"
    __table_args__ = (UniqueConstraint("war_id", "user_id", name="uq_clan_war_member"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    war_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("clan_wars.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # 0 = «Маяк», 1 = «Парус»; empty until the split
    team: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)


class ClanWarDay(Base):
    """A war day, locked at 00:00 (Astana): how many of a team read 30+ minutes
    that day (its strikes) and how many it had. Logs entered later for that
    day no longer change it."""

    __tablename__ = "clan_war_days"
    __table_args__ = (UniqueConstraint("war_id", "date", "team", name="uq_clan_war_day"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    war_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("clan_wars.id", ondelete="CASCADE"), nullable=False, index=True
    )
    date: Mapped[date] = mapped_column(Date, nullable=False)
    team: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    hits: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    size: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
