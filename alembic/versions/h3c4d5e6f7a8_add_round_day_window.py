"""add start_day/end_day day window to rounds

Lets a round cover part of a month (a "mini-round") instead of always
running day 1 through month end. Existing rounds keep whole-month
behaviour: start_day defaults to 1 and end_day stays NULL, which the
model reads as "last day of the month".

Revision ID: h3c4d5e6f7a8
Revises: g2b3c4d5e6f7
Create Date: 2026-08-15 00:00:00.000000

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = 'h3c4d5e6f7a8'
down_revision = 'g2b3c4d5e6f7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'rounds',
        sa.Column('start_day', sa.SmallInteger(), nullable=False, server_default='1'),
    )
    op.add_column(
        'rounds',
        sa.Column('end_day', sa.SmallInteger(), nullable=True),
    )
    op.create_check_constraint(
        'ck_rounds_start_day_range', 'rounds', 'start_day >= 1 AND start_day <= 31'
    )
    op.create_check_constraint(
        'ck_rounds_end_day_range',
        'rounds',
        'end_day IS NULL OR (end_day >= start_day AND end_day <= 31)',
    )


def downgrade() -> None:
    op.drop_constraint('ck_rounds_end_day_range', 'rounds', type_='check')
    op.drop_constraint('ck_rounds_start_day_range', 'rounds', type_='check')
    op.drop_column('rounds', 'end_day')
    op.drop_column('rounds', 'start_day')
