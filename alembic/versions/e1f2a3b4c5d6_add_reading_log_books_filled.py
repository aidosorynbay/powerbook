"""add reading_log_books.filled

Finishing a book, the reader says from which day they read it; days they
logged without naming any book are given to it, marked filled, so that a
shorter period later can take them back.

One column with a default, so this is safe to apply to live data.

Revision ID: e1f2a3b4c5d6
Revises: d0e1f2a3b4c5
Create Date: 2026-10-08

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "e1f2a3b4c5d6"
down_revision = "d0e1f2a3b4c5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "reading_log_books",
        sa.Column("filled", sa.Boolean(), server_default="false", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("reading_log_books", "filled")
