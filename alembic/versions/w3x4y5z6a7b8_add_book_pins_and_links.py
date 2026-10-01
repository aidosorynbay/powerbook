"""add shelf_overrides.work_key and book_links

«Какая это книга?»: a reader's copy pinned to a book of the shared library,
and the founder's links between two books that are one.

A nullable column and a new table, so this is safe to apply to live data.

Revision ID: w3x4y5z6a7b8
Revises: v2w3x4y5z6a7
Create Date: 2026-10-02

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "w3x4y5z6a7b8"
down_revision = "v2w3x4y5z6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("shelf_overrides", sa.Column("work_key", sa.String(length=120), nullable=True))
    op.create_table(
        "book_links",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("key_a", sa.String(length=120), nullable=False),
        sa.Column("key_b", sa.String(length=120), nullable=False),
        sa.Column("title_a", sa.String(length=300), nullable=True),
        sa.Column("title_b", sa.String(length=300), nullable=True),
        sa.Column("created_by", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("key_a", "key_b", name="uq_book_links_pair"),
    )


def downgrade() -> None:
    op.drop_table("book_links")
    op.drop_column("shelf_overrides", "work_key")
