"""make users.gender nullable

The model has always declared gender as `Mapped[Gender | None]` while the
column was NOT NULL — drift that went unnoticed because nothing ever tried to
clear it. Account deletion does, so the two are reconciled here in the
direction the model already assumed.

Dropping NOT NULL cannot invalidate existing rows, so this is safe to apply
to live data.

Revision ID: n4p5q6r7s8t9
Revises: m3n4p5q6r7s8
Create Date: 2026-08-25

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "n4p5q6r7s8t9"
down_revision = "m3n4p5q6r7s8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("users", "gender", existing_type=sa.Enum(name="gender"), nullable=True)


def downgrade() -> None:
    # Rows anonymised by account deletion have no gender to restore, so give
    # them a value rather than failing the downgrade outright.
    op.execute("UPDATE users SET gender = 'male' WHERE gender IS NULL")
    op.alter_column("users", "gender", existing_type=sa.Enum(name="gender"), nullable=False)
