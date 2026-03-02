#!/usr/bin/env python3
"""
Seed script to create the 'powerbook' group and an example round.

Usage:
    python scripts/seed_example_round.py

This will:
1. Create an admin user (if not exists)
2. Create the 'powerbook' group (if not exists)
3. Create a round for the current month with registration open
"""
from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import get_session_factory
from app.models.enums import Gender, GroupMemberRole, MembershipStatus, RoundStatus, SystemRole
from app.models.group import Group, GroupMember
from app.models.round import Round
from app.models.user import User


def main() -> None:
    SessionLocal = get_session_factory()
    db = SessionLocal()
    try:
        now = datetime.now(tz=ZoneInfo("UTC"))

        # 1. Create admin user if not exists
        admin_username = "admin"
        admin = db.execute(select(User).where(User.username == admin_username)).scalar_one_or_none()

        if admin is None:
            admin = User(
                username=admin_username,
                email="admin@powerbook.local",
                password_hash=hash_password("admin123"),
                display_name="Admin",
                gender=Gender.male,
                system_role=SystemRole.admin,
                is_active=True,
            )
            db.add(admin)
            db.commit()
            db.refresh(admin)
            print(f"Created admin user: {admin_username} (password: admin123)")
        else:
            if admin.system_role != SystemRole.admin:
                admin.system_role = SystemRole.admin
                db.commit()
            print(f"Admin user already exists: {admin_username}")

        # 2. Create 'powerbook' group if not exists
        group = db.execute(select(Group).where(Group.slug == "powerbook")).scalar_one_or_none()

        if group is None:
            group = Group(
                name="PowerBook",
                slug="powerbook",
                owner_user_id=admin.id,
            )
            db.add(group)
            db.commit()
            db.refresh(group)

            # Add admin as group member
            membership = GroupMember(
                group_id=group.id,
                user_id=admin.id,
                role=GroupMemberRole.admin,
                status=MembershipStatus.active,
                joined_at=now,
            )
            db.add(membership)
            db.commit()
            print(f"Created group: {group.name} (slug: {group.slug})")
        else:
            print(f"Group already exists: {group.name} (slug: {group.slug})")

        # 3. Create round for current month if not exists
        year = now.year
        month = now.month

        existing_round = db.execute(
            select(Round).where(
                Round.group_id == group.id,
                Round.year == year,
                Round.month == month,
            )
        ).scalar_one_or_none()

        if existing_round is None:
            new_round = Round(
                group_id=group.id,
                year=year,
                month=month,
                status=RoundStatus.registration_open,
                registration_open_until_day=15,
                timezone="UTC",
                started_at=now,
            )
            db.add(new_round)
            db.commit()
            db.refresh(new_round)
            print(f"Created round: {year}-{month:02d} (status: registration_open)")
        else:
            print(f"Round already exists: {year}-{month:02d} (status: {existing_round.status.value})")
            # Optionally open registration if it's closed
            if existing_round.status == RoundStatus.draft:
                existing_round.status = RoundStatus.registration_open
                existing_round.started_at = existing_round.started_at or now
                db.commit()
                print(f"  -> Opened registration for existing round")

        print("\nDone! You can now:")
        print("  1. Register a new user in the frontend")
        print("  2. Join the round from the dashboard")
        print("  3. Log reading minutes")

    finally:
        db.close()


if __name__ == "__main__":
    main()
