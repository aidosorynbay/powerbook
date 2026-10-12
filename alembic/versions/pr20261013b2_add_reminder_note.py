"""reading_reminders.note: the reader's own reminder text

The founder's first test (2026-10-13): a reminder should carry the reader's
own cue («ты сейчас в автобусе, есть 15 минут — почитай»), not only a time.

Revision ID: pr20261013b2
Revises: pr20261013a1
Create Date: 2026-10-13

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "pr20261013b2"
down_revision = "pr20261013a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("reading_reminders", sa.Column("note", sa.String(length=200), nullable=True))


def downgrade() -> None:
    op.drop_column("reading_reminders", "note")
