from __future__ import annotations

import uuid

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.repositories.buddies import BuddyRepository
from app.repositories.users import UserRepository
from app.schemas.social import BuddyOut, DirectoryEntryOut, PublicProfileOut
from app.services.insights import InsightsService


class SocialService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.users = UserRepository(db)
        self.buddies = BuddyRepository(db)
        self.insights = InsightsService(db)

    def _archetype_ref(self, user_id) -> tuple[str | None, int | None]:
        """Archetype identity for list/badge contexts: the key plus the one
        parameter its label needs, so the client renders it in the viewer's
        language instead of us baking an English string into the response."""
        arch = self.insights.archetype(user_id=user_id)
        return arch.key, arch.params.get("weekday")

    def directory(self) -> list[DirectoryEntryOut]:
        out = []
        for u in self.users.list_real_users():
            arch_key, arch_weekday = self._archetype_ref(u.id)
            shelf = self.insights.bookshelf(user_id=u.id)
            recent_books = [b.title for b in shelf[-3:][::-1]]
            badges_earned = sum(1 for b in self.insights.badges(user_id=u.id) if b.earned)
            out.append(
                DirectoryEntryOut(
                    user_id=str(u.id),
                    username=u.username,
                    display_name=u.display_name,
                    telegram_id=u.telegram_id,
                    avatar_data=u.avatar_data,
                    archetype_key=arch_key,
                    archetype_weekday=arch_weekday,
                    recommendation_text=u.recommendation_text,
                    recent_books=recent_books,
                    badges_earned=badges_earned,
                )
            )
        return out

    def public_profile(self, *, target_user_id: uuid.UUID, viewer_id: uuid.UUID) -> PublicProfileOut:
        target = self.users.get(target_user_id)
        if target is None or target.is_claimable:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

        profile = self.insights.all_time_profile(user_id=target.id)
        arch_key, arch_weekday = self._archetype_ref(target.id)
        badges = self.insights.badges(user_id=target.id)
        earned = sum(1 for b in badges if b.earned)
        shelf = self.insights.bookshelf(user_id=target.id)
        recent_books = [b.title for b in shelf[-6:][::-1]]

        is_buddy = self.buddies.get(user_id=viewer_id, buddy_user_id=target.id) is not None

        return PublicProfileOut(
            user_id=str(target.id),
            username=target.username,
            display_name=target.display_name,
            telegram_id=target.telegram_id,
            avatar_data=target.avatar_data,
            recommendation_text=target.recommendation_text,
            reading_music_url=target.reading_music_url,
            archetype_key=arch_key,
            archetype_weekday=arch_weekday,
            total_hours=profile.total_hours,
            longest_streak_days=profile.longest_streak_days,
            rounds_participated=profile.rounds_participated,
            books_finished=profile.books_finished,
            badges_earned=earned,
            badges=badges,
            recent_books=recent_books,
            favorite_books=target.favorite_books or [],
            is_buddy=is_buddy,
            is_self=target.id == viewer_id,
        )

    def add_buddy(self, *, user_id: uuid.UUID, buddy_user_id: uuid.UUID) -> None:
        if user_id == buddy_user_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot add yourself as a buddy")
        target = self.users.get(buddy_user_id)
        if target is None or target.is_claimable:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        if self.buddies.get(user_id=user_id, buddy_user_id=buddy_user_id) is not None:
            return
        self.buddies.create(user_id=user_id, buddy_user_id=buddy_user_id)

    def remove_buddy(self, *, user_id: uuid.UUID, buddy_user_id: uuid.UUID) -> None:
        self.buddies.delete(user_id=user_id, buddy_user_id=buddy_user_id)

    def my_buddies(self, *, user_id: uuid.UUID) -> list[BuddyOut]:
        rows = self.buddies.list_for_user(user_id=user_id)
        out = []
        for row in rows:
            u = self.users.get(row.buddy_user_id)
            if u is None:
                continue
            arch_key, arch_weekday = self._archetype_ref(u.id)
            out.append(
                BuddyOut(
                    user_id=str(u.id),
                    username=u.username,
                    display_name=u.display_name,
                    telegram_id=u.telegram_id,
                    avatar_data=u.avatar_data,
                    archetype_key=arch_key,
                    archetype_weekday=arch_weekday,
                )
            )
        return out

    def my_followers(self, *, user_id: uuid.UUID) -> list[BuddyOut]:
        """Everyone who has added *me* as their buddy — so the one-directional
        follow isn't invisible to the person being added."""
        rows = self.buddies.list_followers(buddy_user_id=user_id)
        out = []
        for row in rows:
            u = self.users.get(row.user_id)
            if u is None:
                continue
            arch_key, arch_weekday = self._archetype_ref(u.id)
            out.append(
                BuddyOut(
                    user_id=str(u.id),
                    username=u.username,
                    display_name=u.display_name,
                    telegram_id=u.telegram_id,
                    avatar_data=u.avatar_data,
                    archetype_key=arch_key,
                    archetype_weekday=arch_weekday,
                )
            )
        return out

