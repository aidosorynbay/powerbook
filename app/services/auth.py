from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.security import create_access_token, hash_password, verify_password
from app.models.enums import Gender
from app.models.user import User
from app.repositories.users import UserRepository


class AuthService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.users = UserRepository(db)

    def register(
        self, *, username: str, password: str, display_name: str, gender: Gender, telegram_id: str, ref: str | None = None
    ) -> tuple[User, str]:
        existing = self.users.get_by_username(username)
        if existing is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already taken")

        existing_tg = self.users.get_by_telegram_id(telegram_id)
        if existing_tg is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Telegram ID already linked to another account")

        try:
            password_hash = hash_password(password)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

        user = self.users.create(
            username=username,
            password_hash=password_hash,
            display_name=display_name,
            gender=gender,
            telegram_id=telegram_id,
            invited_by=self._inviter(ref),
        )
        token = create_access_token(subject=str(user.id))
        return user, token

    def _inviter(self, ref: str | None):
        """The member whose shared link a new reader came by (a day they
        shared, or an invitation), so we can see who brings people in."""
        if not ref:
            return None
        found = self.users.get_by_username(ref.strip().lstrip("@").lower()[:60])
        return found.id if found is not None and found.is_active and not found.is_claimable else None

    def login(self, *, login: str, password: str) -> str:
        user = self.users.get_by_login(login)
        if user is None or not user.is_active:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

        if not verify_password(password, user.password_hash):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

        if user.is_claimable:
            # Someone signed in as this archive identity, so it is not an
            # unclaimed placeholder any more — it is theirs. Leaving the flag
            # set would keep them out of the directory and, worse, keep
            # offering their reading history to strangers to claim.
            user.is_claimable = False
            self.db.commit()

        return create_access_token(subject=str(user.id))

