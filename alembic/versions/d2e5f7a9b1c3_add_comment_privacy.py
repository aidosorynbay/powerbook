"""add is_comment_private to reading_logs

Revision ID: d2e5f7a9b1c3
Revises: c1d4e6f8a9b0
Create Date: 2026-08-11 00:00:00.000000

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = 'd2e5f7a9b1c3'
down_revision = 'c1d4e6f8a9b0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'reading_logs',
        sa.Column('is_comment_private', sa.Boolean(), nullable=False, server_default='false'),
    )


def downgrade() -> None:
    op.drop_column('reading_logs', 'is_comment_private')
