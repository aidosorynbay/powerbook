"""add exchange_photos

Photos of the book exchange, shown on a round's results page.

A new table and nothing else, so this is safe to apply to live data.

Revision ID: v2w3x4y5z6a7
Revises: u1v2w3x4y5z6
Create Date: 2026-10-02

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "v2w3x4y5z6a7"
down_revision = "u1v2w3x4y5z6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "exchange_photos",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("pair_id", sa.Uuid(as_uuid=True), sa.ForeignKey("book_exchange_pairs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(length=10), nullable=False),
        sa.Column("photo", sa.Text(), nullable=False),
        sa.Column("caption", sa.String(length=200), nullable=True),
        sa.Column("hidden", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("pair_id", "user_id", name="uq_exchange_photos_pair_user"),
    )
    op.create_index("ix_exchange_photos_pair_id", "exchange_photos", ["pair_id"])
    op.create_index("ix_exchange_photos_user_id", "exchange_photos", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_exchange_photos_user_id", table_name="exchange_photos")
    op.drop_index("ix_exchange_photos_pair_id", table_name="exchange_photos")
    op.drop_table("exchange_photos")
