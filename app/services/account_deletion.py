from __future__ import annotations

import uuid

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core import storage
from app.core.security import verify_password
from app.models.user import User
from app.repositories.library import LibraryRepository
from app.repositories.users import UserRepository


class AccountDeletionService:
    """Deleting an account without punching holes in five years of community history.

    A hard DELETE would cascade through reading_logs and take the person out
    of every circle they ever read in — which silently rewrites other people's
    leaderboards, the Hall of Fame and the archive. Those rows are shared
    history, not personal data, once they aren't attached to a name.

    So: everything that identifies the person is destroyed (login, contact,
    profile, and every uploaded file), and the day-by-day reading rows stay
    behind under an anonymous shell. The privacy policy says exactly this in
    the same words — the point is that a reader knows what they're getting.
    """

    def __init__(self, db: Session) -> None:
        self.db = db
        self.users = UserRepository(db)
        self.library = LibraryRepository(db)

    def delete_account(self, *, user: User, password: str) -> None:
        # Re-authenticate: a live token in the wrong hands shouldn't be enough
        # to wipe someone's account.
        if not verify_password(password, user.password_hash):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Password is incorrect")

        # 1. Uploaded books are unambiguously theirs — files and rows both go.
        for book in self.library.list_for_user(user_id=user.id):
            storage.delete(book.file_key)
            self.db.delete(book)

        # 2. Strip every identifying field. The username has to stay unique and
        # non-null, so it becomes an opaque tombstone rather than being cleared.
        short = uuid.uuid4().hex[:12]
        user.username = f"deleted_{short}"
        user.display_name = "Deleted reader"
        user.email = None
        user.telegram_id = None
        user.avatar_data = None
        user.recommendation_text = None
        user.reading_music_url = None
        user.favorite_books = None
        user.gender = None
        # An unusable hash: no password can produce it, so the account cannot
        # be logged into again even if is_active were flipped back.
        user.password_hash = "!deleted"
        user.is_active = False

        self.db.add(user)
        self.db.commit()
