from __future__ import annotations
import re
from pydantic import BaseModel, Field, field_validator
from app.models.enums import Gender

USERNAME_RE = re.compile(r'^[a-zA-Z0-9._-]+$')


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=60)
    password: str = Field(min_length=6, max_length=128)
    display_name: str = Field(min_length=1, max_length=120)
    gender: Gender
    telegram_id: str | None = Field(default=None, max_length=120)

    @field_validator("username")
    @classmethod
    def validate_username(cls, v: str) -> str:
        if not USERNAME_RE.match(v):
            raise ValueError("Username may only contain letters, numbers, dots, and dashes.")
        return v.lower()

    @field_validator("password")
    @classmethod
    def validate_password_bcrypt_limit(cls, v: str) -> str:
        if len(v.encode("utf-8")) > 72:
            raise ValueError("Password must be at most 72 bytes (bcrypt limit).")
        return v


class LoginRequest(BaseModel):
    login: str
    password: str


class UpdateProfileRequest(BaseModel):
    username: str | None = Field(default=None, min_length=3, max_length=60)
    email: str | None = Field(default=None, max_length=320)
    display_name: str | None = Field(default=None, min_length=1, max_length=120)
    telegram_id: str | None = Field(default=None, max_length=120)
    gender: Gender | None = None

    @field_validator("username")
    @classmethod
    def validate_username(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if not USERNAME_RE.match(v):
            raise ValueError("Username may only contain letters, numbers, dots, and dashes.")
        return v.lower()


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6, max_length=128)

    @field_validator("new_password")
    @classmethod
    def validate_password_bcrypt_limit(cls, v: str) -> str:
        if len(v.encode("utf-8")) > 72:
            raise ValueError("Password must be at most 72 bytes (bcrypt limit).")
        return v


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"

