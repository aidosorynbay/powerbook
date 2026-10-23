"""book_pairs (the founder's «Одна книга» / «Разные» on likely doubles) and shelf_overrides.finished_on

The council (2026-10-23): a likely double is asked once and the answer kept for good. And the founder: a reader sets
the date they finished a book where they set its cover. One new table and one nullable column: safe on live data.

Revision ID: bp20261023a1
Revises: dn20261022a1
Create Date: 2026-10-23

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "bp20261023a1"
down_revision = "dn20261022a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "book_pairs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("key_a", sa.String(length=120), nullable=False),
        sa.Column("key_b", sa.String(length=120), nullable=False),
        sa.Column("title_a", sa.String(length=300), nullable=False),
        sa.Column("title_b", sa.String(length=300), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False, server_default="asked"),
        sa.Column("decided_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("key_a", "key_b", name="uq_book_pairs_pair"),
    )
    op.add_column("shelf_overrides", sa.Column("finished_on", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("shelf_overrides", "finished_on")
    op.drop_table("book_pairs")
