"""add manual_books

Revision ID: i4d5e6f7a8b9
Revises: h3c4d5e6f7a8
Create Date: 2026-08-16

Books a reader adds to their shelf by hand, for reading that happened
outside a round and so never produced a reading_log.
"""
from alembic import op
import sqlalchemy as sa


revision = 'i4d5e6f7a8b9'
down_revision = 'h3c4d5e6f7a8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'manual_books',
        sa.Column('id', sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column('user_id', sa.Uuid(as_uuid=True), nullable=False),
        sa.Column('title', sa.String(length=300), nullable=False),
        sa.Column('title_norm', sa.String(length=300), nullable=False),
        sa.Column('author', sa.String(length=200), nullable=True),
        sa.Column('finished_on', sa.Date(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('user_id', 'title_norm', name='uq_manual_books_user_title'),
    )
    op.create_index('ix_manual_books_user_id', 'manual_books', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_manual_books_user_id', table_name='manual_books')
    op.drop_table('manual_books')
