"""add favorite_books field to users

Revision ID: f1a2b3c4d5e6
Revises: e3f6a8b0c2d4
Create Date: 2026-08-12 00:00:00.000000

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = 'f1a2b3c4d5e6'
down_revision = 'e3f6a8b0c2d4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('favorite_books', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'favorite_books')
