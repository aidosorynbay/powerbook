"""add sticker_uses

Every story sticker a reader copies, saves or shares as a whole picture, so
/admin → «Стикеры» can show which of the four readers take most. Google
Analytics loses many of these on iPhones: it sends its events about five
seconds late, after the reader has left for Instagram.

A new table only, so this is safe to apply to live data.

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-10-06

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "c9d0e1f2a3b4"
down_revision = "b8c9d0e1f2a3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sticker_uses",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("round_id", sa.Uuid(as_uuid=True), sa.ForeignKey("rounds.id", ondelete="CASCADE"), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("channel", sa.String(length=20), nullable=False),
        sa.Column("template", sa.String(length=20), nullable=False),
        sa.Column("action", sa.String(length=12), nullable=False),
        sa.Column("ink", sa.String(length=8), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_sticker_uses_user_id", "sticker_uses", ["user_id"])
    op.create_index("ix_sticker_uses_round_id", "sticker_uses", ["round_id"])


def downgrade() -> None:
    op.drop_index("ix_sticker_uses_round_id", table_name="sticker_uses")
    op.drop_index("ix_sticker_uses_user_id", table_name="sticker_uses")
    op.drop_table("sticker_uses")
