"""add shelf_overrides

A reader's own corrections to books on their shelf — title, author, and a
cover they picked or photographed. Per reader, so fixing a cover on one
shelf never changes another.

A new table and nothing else, so this is safe to apply to live data.

Revision ID: p6q7r8s9t0u1
Revises: o5p6q7r8s9t0
Create Date: 2026-09-27

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "p6q7r8s9t0u1"
down_revision = "o5p6q7r8s9t0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "shelf_overrides",
        sa.Column("user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("volume_key", sa.String(length=80), primary_key=True),
        sa.Column("title", sa.String(length=300), nullable=True),
        sa.Column("author", sa.String(length=200), nullable=True),
        sa.Column("cover_mode", sa.String(length=12), nullable=False, server_default="auto"),
        sa.Column("image", sa.String(length=60), nullable=True),
        sa.Column("source", sa.String(length=20), nullable=True),
        sa.Column("source_id", sa.String(length=40), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("shelf_overrides")
