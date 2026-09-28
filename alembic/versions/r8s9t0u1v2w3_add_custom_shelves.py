"""add custom_shelves and shelf_placements

A reader's own shelves in their bookcase (named for a theme) and which shelf
each book stands on.

New tables and nothing else, so this is safe to apply to live data.

Revision ID: r8s9t0u1v2w3
Revises: q7r8s9t0u1v2
Create Date: 2026-09-28

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "r8s9t0u1v2w3"
down_revision = "q7r8s9t0u1v2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "custom_shelves",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_custom_shelves_user_id", "custom_shelves", ["user_id"])
    op.create_table(
        "shelf_placements",
        sa.Column("user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("volume_key", sa.String(length=80), primary_key=True),
        sa.Column("shelf_id", sa.Uuid(as_uuid=True), sa.ForeignKey("custom_shelves.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("shelf_placements")
    op.drop_index("ix_custom_shelves_user_id", table_name="custom_shelves")
    op.drop_table("custom_shelves")
