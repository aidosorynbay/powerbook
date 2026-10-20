"""want_books: «Хочу прочитать», a second shelf of books to read later

The founder (2026-10-21): a book from the shared library can go to the read shelf or to «Хочу прочитать», and the
latter counts nowhere. One new table: safe on live data.

Revision ID: wb20261021a1
Revises: so20261020a1
Create Date: 2026-10-21

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "wb20261021a1"
down_revision = "so20261020a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "want_books",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("title_norm", sa.String(length=300), nullable=False),
        sa.Column("author", sa.String(length=200), nullable=True),
        sa.Column("work_key", sa.String(length=300), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "title_norm", name="uq_want_books_user_title"),
    )
    op.create_index("ix_want_books_user_id", "want_books", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_want_books_user_id", table_name="want_books")
    op.drop_table("want_books")
