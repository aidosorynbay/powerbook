"""add book_reviews, book_facts, book_listings and ai_digests

Marks and reviews on the shelf, what the world says about each book of the
shared library, the book market, and the reading summaries Claude writes.

New tables and nothing else, so this is safe to apply to live data.

Revision ID: t0u1v2w3x4y5
Revises: s9t0u1v2w3x4
Create Date: 2026-09-30

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "t0u1v2w3x4y5"
down_revision = "s9t0u1v2w3x4"
branch_labels = None
depends_on = None


def _stamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "book_reviews",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("work_key", sa.String(length=120), nullable=False),
        sa.Column("volume_key", sa.String(length=80), nullable=True),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("author", sa.String(length=200), nullable=True),
        sa.Column("rating", sa.SmallInteger(), nullable=False),
        sa.Column("text", sa.Text(), nullable=True),
        *_stamps(),
        sa.UniqueConstraint("user_id", "work_key", name="uq_book_reviews_user_work"),
    )
    op.create_index("ix_book_reviews_user_id", "book_reviews", ["user_id"])
    op.create_index("ix_book_reviews_work_key", "book_reviews", ["work_key"])

    op.create_table(
        "book_facts",
        sa.Column("key", sa.String(length=120), primary_key=True),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("author", sa.String(length=200), nullable=True),
        sa.Column("status", sa.String(length=12), nullable=False, server_default="pending"),
        sa.Column("rating", sa.Float(), nullable=True),
        sa.Column("rating_scale", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("ratings_count", sa.Integer(), nullable=True),
        sa.Column("rating_source", sa.String(length=20), nullable=True),
        sa.Column("rating_url", sa.String(length=500), nullable=True),
        sa.Column("goodreads_url", sa.String(length=500), nullable=True),
        sa.Column("about", sa.JSON(), nullable=True),
        sa.Column("review", sa.JSON(), nullable=True),
        sa.Column("review_source", sa.String(length=20), nullable=True),
        sa.Column("topics", sa.JSON(), nullable=True),
        sa.Column("subjects", sa.JSON(), nullable=True),
        sa.Column("pages", sa.Integer(), nullable=True),
        sa.Column("year", sa.Integer(), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ai_status", sa.String(length=12), nullable=True),
        sa.Column("ai_checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        *_stamps(),
    )

    op.create_table(
        "book_listings",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("seller_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("author", sa.String(length=200), nullable=True),
        sa.Column("work_key", sa.String(length=120), nullable=True),
        sa.Column("volume_key", sa.String(length=80), nullable=True),
        sa.Column("price", sa.Integer(), nullable=False),
        sa.Column("condition", sa.String(length=12), nullable=False, server_default="good"),
        sa.Column("city", sa.String(length=80), nullable=True),
        sa.Column("contact", sa.String(length=120), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("photo", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=10), nullable=False, server_default="active"),
        sa.Column("sold_at", sa.DateTime(timezone=True), nullable=True),
        *_stamps(),
    )
    op.create_index("ix_book_listings_seller_id", "book_listings", ["seller_id"])
    op.create_index("ix_book_listings_work_key", "book_listings", ["work_key"])
    op.create_index("ix_book_listings_status_created", "book_listings", ["status", "created_at"])

    op.create_table(
        "ai_digests",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(length=10), nullable=False),
        sa.Column("scope", sa.String(length=80), nullable=False),
        sa.Column("lang", sa.String(length=4), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False, server_default="working"),
        sa.Column("input_hash", sa.String(length=64), nullable=False),
        sa.Column("content", sa.JSON(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        *_stamps(),
    )
    op.create_index("ix_ai_digests_user_scope", "ai_digests", ["user_id", "kind", "scope", "lang"])


def downgrade() -> None:
    op.drop_index("ix_ai_digests_user_scope", table_name="ai_digests")
    op.drop_table("ai_digests")
    op.drop_index("ix_book_listings_status_created", table_name="book_listings")
    op.drop_index("ix_book_listings_work_key", table_name="book_listings")
    op.drop_index("ix_book_listings_seller_id", table_name="book_listings")
    op.drop_table("book_listings")
    op.drop_table("book_facts")
    op.drop_index("ix_book_reviews_work_key", table_name="book_reviews")
    op.drop_index("ix_book_reviews_user_id", table_name="book_reviews")
    op.drop_table("book_reviews")
