"""book_dismissals: «Не моё» on the AI librarian's picks

The founder (2026-10-21): the AI librarian suggests what to read next from a reader's marks, and a book the reader
turns down is never suggested again. One new table: safe on live data.

Revision ID: bd20261021a1
Revises: wb20261021a1
Create Date: 2026-10-21

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "bd20261021a1"
down_revision = "wb20261021a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "book_dismissals",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("work_key", sa.String(length=300), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("author", sa.String(length=200), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "work_key", name="uq_book_dismissals_user_work"),
    )
    op.create_index("ix_book_dismissals_user_id", "book_dismissals", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_book_dismissals_user_id", table_name="book_dismissals")
    op.drop_table("book_dismissals")
