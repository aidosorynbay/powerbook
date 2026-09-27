"""add book_covers

A shared cache of what the internet knows about each title readers have
finished: a corrected spelling, the author, and a cover image kept on disk.
One row per title, not per reader, so a book is only ever looked up once.

A new table and nothing else, so this is safe to apply to live data.

Revision ID: o5p6q7r8s9t0
Revises: n4p5q6r7s8t9
Create Date: 2026-09-27

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "o5p6q7r8s9t0"
down_revision = "n4p5q6r7s8t9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "book_covers",
        sa.Column("key", sa.String(length=300), primary_key=True, nullable=False),
        sa.Column("query", sa.String(length=300), nullable=False),
        sa.Column("status", sa.String(length=12), nullable=False, server_default="pending"),
        sa.Column("title", sa.String(length=300), nullable=True),
        sa.Column("author", sa.String(length=200), nullable=True),
        sa.Column("source", sa.String(length=20), nullable=True),
        sa.Column("source_id", sa.String(length=40), nullable=True),
        sa.Column("image", sa.String(length=60), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_book_covers_status", "book_covers", ["status"])


def downgrade() -> None:
    op.drop_index("ix_book_covers_status", table_name="book_covers")
    op.drop_table("book_covers")
