"""clan_wars and clan_war_members, with the first war (17–30 October 2026)

«Битва кланов»: readers sign up, the founder splits them into two teams.
New tables only: safe on live data.

Revision ID: cw20261017a1
Revises: vo20261015a1
Create Date: 2026-10-17

"""
from __future__ import annotations

import uuid
from datetime import date

import sqlalchemy as sa
from alembic import op

revision = "cw20261017a1"
down_revision = "vo20261015a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    wars = op.create_table(
        "clan_wars",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="signup"),
        sa.Column("prize", sa.Text(), nullable=True),
        sa.Column("split_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        "clan_war_members",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("war_id", sa.Uuid(as_uuid=True), sa.ForeignKey("clan_wars.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("team", sa.SmallInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("war_id", "user_id", name="uq_clan_war_member"),
    )
    op.create_index("ix_clan_war_members_war_id", "clan_war_members", ["war_id"])
    op.create_index("ix_clan_war_members_user_id", "clan_war_members", ["user_id"])
    op.bulk_insert(wars, [{"id": uuid.uuid4(), "start_date": date(2026, 10, 17), "end_date": date(2026, 10, 30), "status": "signup"}])


def downgrade() -> None:
    op.drop_index("ix_clan_war_members_user_id", table_name="clan_war_members")
    op.drop_index("ix_clan_war_members_war_id", table_name="clan_war_members")
    op.drop_table("clan_war_members")
    op.drop_table("clan_wars")
