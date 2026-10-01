"""add reading_log_books

«Что читаю» in the minutes form: which book a day's minutes went to, split
across books when a day held more than one.

A new table only, so this is safe to apply to live data.

Revision ID: z6a7b8c9d0e1
Revises: y5z6a7b8c9d0
Create Date: 2026-10-02

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "z6a7b8c9d0e1"
down_revision = "y5z6a7b8c9d0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "reading_log_books",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column(
            "reading_log_id", sa.Uuid(as_uuid=True),
            sa.ForeignKey("reading_logs.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("title_norm", sa.String(length=300), nullable=False),
        sa.Column("minutes", sa.Integer(), nullable=False),
        sa.Column("finished", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("position", sa.SmallInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("minutes >= 0", name="ck_reading_log_books_minutes_non_negative"),
    )
    op.create_index("ix_reading_log_books_reading_log_id", "reading_log_books", ["reading_log_id"])
    op.create_index("ix_reading_log_books_user_title", "reading_log_books", ["user_id", "title_norm"])


def downgrade() -> None:
    op.drop_index("ix_reading_log_books_user_title", table_name="reading_log_books")
    op.drop_index("ix_reading_log_books_reading_log_id", table_name="reading_log_books")
    op.drop_table("reading_log_books")
