"""add round_waitlist

Readers waiting for next month's circle, and who invited them.

A new table and nothing else, so this is safe to apply to live data.

Revision ID: u1v2w3x4y5z6
Revises: t0u1v2w3x4y5
Create Date: 2026-09-30

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "u1v2w3x4y5z6"
down_revision = "t0u1v2w3x4y5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "round_waitlist",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("group_id", sa.Uuid(as_uuid=True), sa.ForeignKey("groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("year", sa.SmallInteger(), nullable=False),
        sa.Column("month", sa.SmallInteger(), nullable=False),
        sa.Column("user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("invited_by", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("group_id", "year", "month", "user_id", name="uq_round_waitlist_user"),
    )
    op.create_index("ix_round_waitlist_period", "round_waitlist", ["group_id", "year", "month"])
    op.create_index("ix_round_waitlist_user_id", "round_waitlist", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_round_waitlist_user_id", table_name="round_waitlist")
    op.drop_index("ix_round_waitlist_period", table_name="round_waitlist")
    op.drop_table("round_waitlist")
