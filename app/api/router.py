from fastapi import APIRouter

from app.api.routes import auth, claims, exchange, groups, insights, items, library, reading_room, rounds, social, stats, suggestions
api_router = APIRouter()
api_router.include_router(items.router, tags=["items"])
api_router.include_router(auth.router)
api_router.include_router(groups.router)
api_router.include_router(rounds.router)
api_router.include_router(exchange.router)
api_router.include_router(stats.router)
api_router.include_router(insights.router)
api_router.include_router(claims.router)
api_router.include_router(social.router)
api_router.include_router(suggestions.router)
api_router.include_router(library.router)
api_router.include_router(reading_room.router)
