"""checkins.step and direct_messages.voice

«Хей, как вы?» grows up (2026-10-15): PowerBook writes, on its own, at most twice
in one pause (`step` 1, then the last one a week in), and a message can speak in
PowerBook's voice rather than a person's (`voice`), with the founder answering
in his own.

A column with a default and a constraint swapped for a wider one: safe on live data.

Revision ID: vo20261015a1
Revises: bc20261015a1
Create Date: 2026-10-15

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "vo20261015a1"
down_revision = "bc20261015a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("checkins", sa.Column("step", sa.SmallInteger(), nullable=False, server_default="1"))
    op.drop_constraint("uq_checkins_pause", "checkins", type_="unique")
    op.create_unique_constraint("uq_checkins_pause_step", "checkins", ["user_id", "round_id", "last_read", "step"])
    op.add_column("direct_messages", sa.Column("voice", sa.String(length=20), nullable=True))


def downgrade() -> None:
    op.drop_column("direct_messages", "voice")
    op.drop_constraint("uq_checkins_pause_step", "checkins", type_="unique")
    op.execute("DELETE FROM checkins WHERE step > 1")
    op.create_unique_constraint("uq_checkins_pause", "checkins", ["user_id", "round_id", "last_read"])
    op.drop_column("checkins", "step")
