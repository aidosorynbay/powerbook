"""Add book exchange status timestamps.

Revision ID: 20260117_0002
Revises: 20260117_0001
Create Date: 2026-01-17
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260117_0002"
down_revision = "20260117_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "book_exchange_pairs",
        sa.Column("giver_marked_given_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "book_exchange_pairs",
        sa.Column("receiver_marked_received_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("book_exchange_pairs", "receiver_marked_received_at")
    op.drop_column("book_exchange_pairs", "giver_marked_given_at")

