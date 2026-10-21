"""clan_war_room_reads: war days counted at 00:00 from the reading room

New table only: safe on live data.

Revision ID: rr20261022a1
Revises: bd20261021a1
Create Date: 2026-10-22

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "rr20261022a1"
down_revision = "bd20261021a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "clan_war_room_reads",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("war_id", sa.Uuid(as_uuid=True), sa.ForeignKey("clan_wars.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("minutes", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("war_id", "user_id", "date", name="uq_clan_war_room_read"),
    )
    op.create_index("ix_clan_war_room_reads_war_id", "clan_war_room_reads", ["war_id"])
    op.create_index("ix_clan_war_room_reads_user_id", "clan_war_room_reads", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_clan_war_room_reads_user_id", table_name="clan_war_room_reads")
    op.drop_index("ix_clan_war_room_reads_war_id", table_name="clan_war_room_reads")
    op.drop_table("clan_war_room_reads")
