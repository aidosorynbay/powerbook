"""book_dna: what each book of the library is like (mood, pace, themes…), for the AI librarian's matching

The founder (2026-10-22): picks from a deep reading of the reader's taste, not from one shared ten. One new table:
safe on live data.

Revision ID: dn20261022a1
Revises: rr20261022a1
Create Date: 2026-10-22

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "dn20261022a1"
down_revision = "rr20261022a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "book_dna",
        sa.Column("key", sa.String(length=300), primary_key=True),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("author", sa.String(length=200), nullable=True),
        sa.Column("status", sa.String(length=10), nullable=False, server_default="done"),
        sa.Column("traits", sa.JSON(), nullable=True),
        sa.Column("essence", sa.Text(), nullable=True),
        sa.Column("model", sa.String(length=60), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("book_dna")
