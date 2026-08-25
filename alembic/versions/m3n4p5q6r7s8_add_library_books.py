"""add library_books

Revision ID: m3n4p5q6r7s8
Revises: k6f7a8b9c0d1
Create Date: 2026-08-25

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "m3n4p5q6r7s8"
down_revision = "k6f7a8b9c0d1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "library_books",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("user_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("author", sa.String(length=200), nullable=True),
        sa.Column("file_format", sa.String(length=10), nullable=False),
        sa.Column("file_key", sa.String(length=500), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cover_data", sa.Text(), nullable=True),
        sa.Column("progress_percent", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("progress_position", sa.Text(), nullable=True),
        sa.Column("last_read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_visible_to_buddies", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE", name="fk_library_books_user_id_users"),
    )
    op.create_index("ix_library_books_user_id", "library_books", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_library_books_user_id", table_name="library_books")
    op.drop_table("library_books")
