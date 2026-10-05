"""add day_shares and users.invited_by

Sharing a reading day, Strava-style: day_shares records each day a reader sent
out (and opens their day page to people without an account), and
users.invited_by remembers whose link a new reader signed up from.

A new table and one nullable column, so this is safe to apply to live data.

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-10-05

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "b8c9d0e1f2a3"
down_revision = "a7b8c9d0e1f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "day_shares",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("round_id", sa.Uuid(as_uuid=True), sa.ForeignKey("rounds.id", ondelete="CASCADE"), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("channel", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "day", "channel", name="uq_day_shares_user_day_channel"),
    )
    op.create_index("ix_day_shares_user_id", "day_shares", ["user_id"])
    op.create_index("ix_day_shares_round_id", "day_shares", ["round_id"])
    op.add_column("users", sa.Column("invited_by", sa.Uuid(as_uuid=True), nullable=True))
    op.create_foreign_key("fk_users_invited_by", "users", "users", ["invited_by"], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    op.drop_constraint("fk_users_invited_by", "users", type_="foreignkey")
    op.drop_column("users", "invited_by")
    op.drop_index("ix_day_shares_round_id", table_name="day_shares")
    op.drop_index("ix_day_shares_user_id", table_name="day_shares")
    op.drop_table("day_shares")
