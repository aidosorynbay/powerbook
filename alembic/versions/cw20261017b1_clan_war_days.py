"""clan_war_days: each war day locked at midnight (strikes per team)

New table only: safe on live data.

Revision ID: cw20261017b1
Revises: cw20261017a1
Create Date: 2026-10-17

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "cw20261017b1"
down_revision = "cw20261017a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "clan_war_days",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("war_id", sa.Uuid(as_uuid=True), sa.ForeignKey("clan_wars.id", ondelete="CASCADE"), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("team", sa.SmallInteger(), nullable=False),
        sa.Column("hits", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("size", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.UniqueConstraint("war_id", "date", "team", name="uq_clan_war_day"),
    )
    op.create_index("ix_clan_war_days_war_id", "clan_war_days", ["war_id"])


def downgrade() -> None:
    op.drop_index("ix_clan_war_days_war_id", table_name="clan_war_days")
    op.drop_table("clan_war_days")
