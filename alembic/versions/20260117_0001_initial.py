"""initial

Revision ID: 20260117_0001
Revises: 
Create Date: 2026-01-17

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260117_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Enums
    # NOTE: We create enum types explicitly (checkfirst=True) and then re-use them in
    # table definitions with create_type=False to prevent duplicate CREATE TYPE calls.
    gender = postgresql.ENUM("male", "female", name="gender", create_type=False)
    system_role = postgresql.ENUM("user", "admin", "superadmin", name="system_role", create_type=False)
    group_member_role = postgresql.ENUM("admin", "member", name="group_member_role", create_type=False)
    membership_status = postgresql.ENUM("invited", "active", "removed", name="membership_status", create_type=False)
    round_status = postgresql.ENUM(
        "draft",
        "registration_open",
        "locked",
        "closed",
        "results_published",
        name="round_status",
        create_type=False,
    )
    round_participant_status = postgresql.ENUM(
        "active",
        "left_before_deadline",
        "locked",
        "penalty_left",
        "removed_by_admin",
        name="round_participant_status",
        create_type=False,
    )
    result_group = postgresql.ENUM("winner", "loser", name="result_group", create_type=False)

    gender.create(op.get_bind(), checkfirst=True)
    system_role.create(op.get_bind(), checkfirst=True)
    group_member_role.create(op.get_bind(), checkfirst=True)
    membership_status.create(op.get_bind(), checkfirst=True)
    round_status.create(op.get_bind(), checkfirst=True)
    round_participant_status.create(op.get_bind(), checkfirst=True)
    result_group.create(op.get_bind(), checkfirst=True)

    # users
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=120), nullable=False),
        sa.Column("gender", gender, nullable=True),
        sa.Column("system_role", system_role, nullable=False, server_default="user"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("email", name="uq_users_email"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    # groups
    op.create_table(
        "groups",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("slug", sa.String(length=80), nullable=False),
        sa.Column("owner_user_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["owner_user_id"],
            ["users.id"],
            name="fk_groups_owner_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("slug", name="uq_groups_slug"),
    )
    op.create_index("ix_groups_slug", "groups", ["slug"], unique=True)

    # group_members
    op.create_table(
        "group_members",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("group_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("user_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("role", group_member_role, nullable=False, server_default="member"),
        sa.Column("status", membership_status, nullable=False, server_default="active"),
        sa.Column("invited_by_user_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("invited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["group_id"],
            ["groups.id"],
            name="fk_group_members_group_id_groups",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_group_members_user_id_users",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["invited_by_user_id"],
            ["users.id"],
            name="fk_group_members_invited_by_user_id_users",
            ondelete="SET NULL",
        ),
        sa.UniqueConstraint("group_id", "user_id", name="uq_group_members_group_user"),
    )
    op.create_index("ix_group_members_group_id", "group_members", ["group_id"])
    op.create_index("ix_group_members_user_id", "group_members", ["user_id"])

    # rounds
    op.create_table(
        "rounds",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("group_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("month", sa.SmallInteger(), nullable=False),
        sa.Column("status", round_status, nullable=False, server_default="draft"),
        sa.Column("registration_open_until_day", sa.SmallInteger(), nullable=False, server_default="10"),
        sa.Column("timezone", sa.String(length=64), nullable=False, server_default="UTC"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["group_id"],
            ["groups.id"],
            name="fk_rounds_group_id_groups",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("group_id", "year", "month", name="uq_rounds_group_year_month"),
        sa.CheckConstraint("month >= 1 AND month <= 12", name="ck_rounds_month_range"),
    )
    op.create_index("ix_rounds_group_id", "rounds", ["group_id"])

    # round_participants
    op.create_table(
        "round_participants",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("round_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("user_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column(
            "status",
            round_participant_status,
            nullable=False,
            server_default="active",
        ),
        sa.Column(
            "joined_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("left_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["round_id"],
            ["rounds.id"],
            name="fk_round_participants_round_id_rounds",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_round_participants_user_id_users",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("round_id", "user_id", name="uq_round_participants_round_user"),
    )
    op.create_index("ix_round_participants_round_id", "round_participants", ["round_id"])
    op.create_index("ix_round_participants_user_id", "round_participants", ["user_id"])

    # reading_logs
    op.create_table(
        "reading_logs",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("round_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("user_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("minutes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("score", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["round_id"],
            ["rounds.id"],
            name="fk_reading_logs_round_id_rounds",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_reading_logs_user_id_users",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "round_id",
            "user_id",
            "date",
            name="uq_reading_logs_round_user_date",
        ),
        sa.CheckConstraint("minutes >= 0", name="ck_reading_logs_minutes_non_negative"),
        sa.CheckConstraint("score IN (0, 1)", name="ck_reading_logs_score_0_1"),
    )
    op.create_index("ix_reading_logs_round_id", "reading_logs", ["round_id"])
    op.create_index("ix_reading_logs_user_id", "reading_logs", ["user_id"])
    op.create_index("ix_reading_logs_date", "reading_logs", ["date"])

    # round_results
    op.create_table(
        "round_results",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("round_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("user_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("total_score", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("rank", sa.Integer(), nullable=False),
        sa.Column("group", result_group, nullable=False),
        sa.Column(
            "computed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["round_id"],
            ["rounds.id"],
            name="fk_round_results_round_id_rounds",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_round_results_user_id_users",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("round_id", "user_id", name="uq_round_results_round_user"),
        sa.CheckConstraint("total_score >= 0", name="ck_round_results_total_score_non_negative"),
        sa.CheckConstraint("rank >= 1", name="ck_round_results_rank_positive"),
    )
    op.create_index("ix_round_results_round_id", "round_results", ["round_id"])
    op.create_index("ix_round_results_user_id", "round_results", ["user_id"])

    # book_exchange_pairs
    op.create_table(
        "book_exchange_pairs",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("round_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("giver_user_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("receiver_user_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["round_id"],
            ["rounds.id"],
            name="fk_book_exchange_pairs_round_id_rounds",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["giver_user_id"],
            ["users.id"],
            name="fk_book_exchange_pairs_giver_user_id_users",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["receiver_user_id"],
            ["users.id"],
            name="fk_book_exchange_pairs_receiver_user_id_users",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("round_id", "giver_user_id", name="uq_book_exchange_pairs_round_giver"),
        sa.CheckConstraint("giver_user_id <> receiver_user_id", name="ck_book_exchange_pairs_no_self_pair"),
    )
    op.create_index("ix_book_exchange_pairs_round_id", "book_exchange_pairs", ["round_id"])
    op.create_index("ix_book_exchange_pairs_giver_user_id", "book_exchange_pairs", ["giver_user_id"])
    op.create_index("ix_book_exchange_pairs_receiver_user_id", "book_exchange_pairs", ["receiver_user_id"])


def downgrade() -> None:
    op.drop_index("ix_book_exchange_pairs_receiver_user_id", table_name="book_exchange_pairs")
    op.drop_index("ix_book_exchange_pairs_giver_user_id", table_name="book_exchange_pairs")
    op.drop_index("ix_book_exchange_pairs_round_id", table_name="book_exchange_pairs")
    op.drop_table("book_exchange_pairs")

    op.drop_index("ix_round_results_user_id", table_name="round_results")
    op.drop_index("ix_round_results_round_id", table_name="round_results")
    op.drop_table("round_results")

    op.drop_index("ix_reading_logs_date", table_name="reading_logs")
    op.drop_index("ix_reading_logs_user_id", table_name="reading_logs")
    op.drop_index("ix_reading_logs_round_id", table_name="reading_logs")
    op.drop_table("reading_logs")

    op.drop_index("ix_round_participants_user_id", table_name="round_participants")
    op.drop_index("ix_round_participants_round_id", table_name="round_participants")
    op.drop_table("round_participants")

    op.drop_index("ix_rounds_group_id", table_name="rounds")
    op.drop_table("rounds")

    op.drop_index("ix_group_members_user_id", table_name="group_members")
    op.drop_index("ix_group_members_group_id", table_name="group_members")
    op.drop_table("group_members")

    op.drop_index("ix_groups_slug", table_name="groups")
    op.drop_table("groups")

    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")

    # Drop enums last (shared types)
    op.execute("DROP TYPE IF EXISTS result_group")
    op.execute("DROP TYPE IF EXISTS round_participant_status")
    op.execute("DROP TYPE IF EXISTS round_status")
    op.execute("DROP TYPE IF EXISTS membership_status")
    op.execute("DROP TYPE IF EXISTS group_member_role")
    op.execute("DROP TYPE IF EXISTS system_role")
    op.execute("DROP TYPE IF EXISTS gender")

