"""clan_war_reads: reading logged on the war page by members outside the month's circle

New table only: safe on live data.

Revision ID: cw20261017d1
Revises: cw20261017c1
Create Date: 2026-10-17

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "cw20261017d1"
down_revision = "cw20261017c1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "clan_war_reads",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("war_id", sa.Uuid(as_uuid=True), sa.ForeignKey("clan_wars.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("minutes", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("war_id", "user_id", "date", name="uq_clan_war_read"),
    )
    op.create_index("ix_clan_war_reads_war_id", "clan_war_reads", ["war_id"])
    op.create_index("ix_clan_war_reads_user_id", "clan_war_reads", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_clan_war_reads_user_id", table_name="clan_war_reads")
    op.drop_index("ix_clan_war_reads_war_id", table_name="clan_war_reads")
    op.drop_table("clan_war_reads")
