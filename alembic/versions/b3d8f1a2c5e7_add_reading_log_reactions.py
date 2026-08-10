"""add reading_log_reactions table

Revision ID: b3d8f1a2c5e7
Revises: a7c2e9f01b34
Create Date: 2026-08-11 00:00:00.000000

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = 'b3d8f1a2c5e7'
down_revision = 'a7c2e9f01b34'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'reading_log_reactions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('reading_log_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('emoji', sa.String(length=8), nullable=False, server_default='🔥'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['reading_log_id'], ['reading_logs.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('reading_log_id', 'user_id', name='uq_reading_log_reactions_log_user'),
    )
    op.create_index(
        'ix_reading_log_reactions_reading_log_id', 'reading_log_reactions', ['reading_log_id']
    )
    op.create_index(
        'ix_reading_log_reactions_user_id', 'reading_log_reactions', ['user_id']
    )


def downgrade() -> None:
    op.drop_index('ix_reading_log_reactions_user_id', table_name='reading_log_reactions')
    op.drop_index('ix_reading_log_reactions_reading_log_id', table_name='reading_log_reactions')
    op.drop_table('reading_log_reactions')
