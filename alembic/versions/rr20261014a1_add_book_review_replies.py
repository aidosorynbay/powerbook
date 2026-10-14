"""add book_review_replies

Readers answer each other's reviews: a small flat thread under each one,
like a chat. The founder asked for it on 2026-10-14, after the bell said a
reader had reviewed «Мартин Иден» and there was nowhere to answer her.

A new table only, so this is safe to apply to live data.

Revision ID: rr20261014a1
Revises: an20261014b1
Create Date: 2026-10-14

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "rr20261014a1"
down_revision = "an20261014b1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "book_review_replies",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("review_id", sa.Uuid(as_uuid=True), sa.ForeignKey("book_reviews.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_book_review_replies_review_created", "book_review_replies", ["review_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_book_review_replies_review_created", table_name="book_review_replies")
    op.drop_table("book_review_replies")
