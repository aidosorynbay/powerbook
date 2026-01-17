from fastapi import APIRouter

from app.api.routes import auth, exchange, items, rounds
api_router = APIRouter()
api_router.include_router(items.router, tags=["items"])
api_router.include_router(auth.router)
api_router.include_router(rounds.router)
api_router.include_router(exchange.router)

