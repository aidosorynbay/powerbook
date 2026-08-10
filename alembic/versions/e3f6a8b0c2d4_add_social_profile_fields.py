"""add avatar/recommendation/music profile fields and reading_buddies table

Revision ID: e3f6a8b0c2d4
Revises: d2e5f7a9b1c3
Create Date: 2026-08-11 00:00:00.000000

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = 'e3f6a8b0c2d4'
down_revision = 'd2e5f7a9b1c3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('avatar_data', sa.Text(), nullable=True))
    op.add_column('users', sa.Column('recommendation_text', sa.Text(), nullable=True))
    op.add_column('users', sa.Column('reading_music_url', sa.String(length=500), nullable=True))

    op.create_table(
        'reading_buddies',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('buddy_user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['buddy_user_id'], ['users.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('user_id', 'buddy_user_id', name='uq_reading_buddies_user_buddy'),
        sa.CheckConstraint('user_id <> buddy_user_id', name='ck_reading_buddies_no_self'),
    )
    op.create_index('ix_reading_buddies_user_id', 'reading_buddies', ['user_id'])
    op.create_index('ix_reading_buddies_buddy_user_id', 'reading_buddies', ['buddy_user_id'])


def downgrade() -> None:
    op.drop_index('ix_reading_buddies_buddy_user_id', table_name='reading_buddies')
    op.drop_index('ix_reading_buddies_user_id', table_name='reading_buddies')
    op.drop_table('reading_buddies')
    op.drop_column('users', 'reading_music_url')
    op.drop_column('users', 'recommendation_text')
    op.drop_column('users', 'avatar_data')
