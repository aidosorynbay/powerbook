from fastapi import APIRouter

from app.core.config import settings

router = APIRouter(tags=["root"])


@router.get("/")
def root() -> dict:
    return {"message": f"Welcome to {settings.app_name}"}

