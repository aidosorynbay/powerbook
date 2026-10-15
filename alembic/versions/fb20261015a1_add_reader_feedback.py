"""add reader_feedback and feedback_asks

The window after a saved day: what a reader thinks of PowerBook, in one tap,
a few words and, if they like, a photo of how they read. The founder asked
for it on 2026-10-13 («максимально удобный и простой»), and on 2026-10-15
for the photos of real readers the brand book needs to come through it, with
the reader's own tick that a photo may be shown.

feedback_asks keeps when the window last came up for each reader, so that
«at most once a month» holds across their browsers and the home-screen app.

New tables only, so this is safe to apply to live data.

Revision ID: fb20261015a1
Revises: rr20261014a1
Create Date: 2026-10-15

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "fb20261015a1"
down_revision = "rr20261014a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "reader_feedback",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("round_id", sa.Uuid(as_uuid=True), sa.ForeignKey("rounds.id", ondelete="SET NULL"), nullable=True),
        sa.Column("mood", sa.String(length=10), nullable=True),
        sa.Column("text", sa.Text(), nullable=True),
        sa.Column("photo", sa.Text(), nullable=True),
        sa.Column("photo_consent", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("consent_version", sa.String(length=20), nullable=True),
        sa.Column("source", sa.String(length=20), nullable=True),
        sa.Column("locale", sa.String(length=5), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_reader_feedback_user_id", "reader_feedback", ["user_id"])
    op.create_table(
        "feedback_asks",
        sa.Column("user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("asked_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("feedback_asks")
    op.drop_index("ix_reader_feedback_user_id", table_name="reader_feedback")
    op.drop_table("reader_feedback")
