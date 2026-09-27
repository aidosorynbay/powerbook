"""add book_notes

A reader's own notes on books on their shelf. Private, as many per book as
they like.

A new table and nothing else, so this is safe to apply to live data.

Revision ID: q7r8s9t0u1v2
Revises: p6q7r8s9t0u1
Create Date: 2026-09-28

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "q7r8s9t0u1v2"
down_revision = "p6q7r8s9t0u1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "book_notes",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("volume_key", sa.String(length=80), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_book_notes_user_volume", "book_notes", ["user_id", "volume_key"])


def downgrade() -> None:
    op.drop_index("ix_book_notes_user_volume", table_name="book_notes")
    op.drop_table("book_notes")
