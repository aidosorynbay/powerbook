from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import JSON, Date, DateTime, ForeignKey, SmallInteger, String, Text, UniqueConstraint, Uuid
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


class ClanWarRead(TimestampMixin, Base):
    """Reading logged on the war page by a member who is not in the month's
    circle (a guest brought in by the war). It counts for the war only and never
    enters the circle's table; circle members log on the circle's dial."""

    __tablename__ = "clan_war_reads"
    __table_args__ = (UniqueConstraint("war_id", "user_id", "date", name="uq_clan_war_read"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    war_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("clan_wars.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    date: Mapped[date] = mapped_column(Date, nullable=False)
    minutes: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)


class ClanWarMessage(TimestampMixin, Base):
    """«Чат команды»: one room per team, seen only by its members. A reader's words
    (kind «user», text) or the bot's numbers (kind «bot», code + params, worded on the
    reader's side in their language; `key` keeps each bot line single across workers)."""

    __tablename__ = "clan_war_messages"
    __table_args__ = (UniqueConstraint("war_id", "team", "key", name="uq_clan_war_message_key"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    war_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("clan_wars.id", ondelete="CASCADE"), nullable=False, index=True
    )
    team: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    kind: Mapped[str] = mapped_column(String(8), nullable=False, default="user")
    text: Mapped[str | None] = mapped_column(Text, nullable=True)
    code: Mapped[str | None] = mapped_column(String(24), nullable=True)
    params: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    key: Mapped[str | None] = mapped_column(String(40), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ClanWarReport(TimestampMixin, Base):
    """A complaint about a team-chat message. The founder hears in Telegram (without the
    message's text, which never leaves our server) and settles it in the chat itself."""

    __tablename__ = "clan_war_reports"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    message_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("clan_war_messages.id", ondelete="CASCADE"), nullable=False, index=True
    )
    reporter_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
