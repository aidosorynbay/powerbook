from fastapi import FastAPI

from app.api.router import api_router
from app.api.routes.health import router as health_router
from app.api.routes.root import router as root_router
from app.core.config import settings
from app.core.logging import configure_logging


def create_app() -> FastAPI:
    configure_logging()

    app = FastAPI(title=settings.app_name)

    app.include_router(root_router)
    app.include_router(health_router)
    app.include_router(api_router, prefix=settings.api_prefix)

    return app


app = create_app()

