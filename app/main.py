import calendar
import logging
from contextlib import asynccontextmanager
from datetime import datetime
from zoneinfo import ZoneInfo

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from app.api.router import api_router
from app.api.routes.health import router as health_router
from app.api.routes.root import router as root_router
from app.core.config import settings
from app.core.logging import configure_logging
from app.db.session import get_session_factory
from app.models.enums import RoundStatus
from app.models.round import Round
from app.services.rounds import RoundService

logger = logging.getLogger(__name__)

ROUND_TZ = ZoneInfo("Asia/Almaty")  # GMT+5
DEFAULT_GROUP_SLUG = "powerbook"


def _tick_round_lifecycle() -> None:
    """Runs every minute. Handles automatic round transitions."""
    SessionLocal = get_session_factory()
    db = SessionLocal()
    try:
        now = datetime.now(tz=ROUND_TZ)
        today = now.date()

        # Find all active rounds (registration_open or locked)
        stmt = select(Round).where(Round.status.in_([RoundStatus.registration_open, RoundStatus.locked]))
        rounds = list(db.execute(stmt).scalars().all())

        svc = RoundService(db)

        for rnd in rounds:
            # Auto-lock: registration_open and past the deadline day
            if rnd.status == RoundStatus.registration_open:
                if today.year == rnd.year and today.month == rnd.month and today.day > rnd.registration_open_until_day:
                    svc.set_status(round_id=rnd.id, status_=RoundStatus.locked)
                    logger.info("Auto-locked round %s (past day %d)", rnd.id, rnd.registration_open_until_day)

            # Auto-close: locked and past midnight GMT+5 on last day of month
            if rnd.status == RoundStatus.locked:
                last_day = calendar.monthrange(rnd.year, rnd.month)[1]
                if (today.year > rnd.year or today.month > rnd.month
                        or (today.year == rnd.year and today.month == rnd.month and today.day > last_day)):
                    # Past the round's month entirely — close and publish
                    try:
                        svc.compute_and_publish_results(round_id=rnd.id)
                        logger.info("Auto-published results for round %s", rnd.id)
                    except Exception:
                        logger.exception("Failed to publish results for round %s", rnd.id)
                        continue

                    # Auto-create next month's round
                    if rnd.month == 12:
                        next_year, next_month = rnd.year + 1, 1
                    else:
                        next_year, next_month = rnd.year, rnd.month + 1

                    try:
                        svc.create_round(
                            group_id=rnd.group_id,
                            year=next_year,
                            month=next_month,
                            timezone=rnd.timezone,
                            registration_open_until_day=rnd.registration_open_until_day,
                        )
                        svc.set_status(
                            round_id=db.execute(
                                select(Round).where(
                                    Round.group_id == rnd.group_id,
                                    Round.year == next_year,
                                    Round.month == next_month,
                                )
                            ).scalar_one().id,
                            status_=RoundStatus.registration_open,
                        )
                        logger.info("Auto-created round %d-%02d", next_year, next_month)
                    except Exception:
                        logger.exception("Failed to create next round after %s", rnd.id)
                elif (today.year == rnd.year and today.month == rnd.month
                      and today.day == last_day and now.hour >= 20):
                    # 8 PM GMT+5 on last day: close round and create next
                    try:
                        svc.compute_and_publish_results(round_id=rnd.id)
                        logger.info("Auto-published results for round %s at 8PM on last day", rnd.id)
                    except Exception:
                        logger.exception("Failed to publish results for round %s at 8PM", rnd.id)
                        continue

                    # Auto-create next month's round
                    if rnd.month == 12:
                        next_year, next_month = rnd.year + 1, 1
                    else:
                        next_year, next_month = rnd.year, rnd.month + 1

                    existing_next = db.execute(
                        select(Round).where(
                            Round.group_id == rnd.group_id,
                            Round.year == next_year,
                            Round.month == next_month,
                        )
                    ).scalar_one_or_none()

                    if existing_next is None:
                        try:
                            svc.create_round(
                                group_id=rnd.group_id,
                                year=next_year,
                                month=next_month,
                                timezone=rnd.timezone,
                                registration_open_until_day=rnd.registration_open_until_day,
                            )
                            new_rnd = db.execute(
                                select(Round).where(
                                    Round.group_id == rnd.group_id,
                                    Round.year == next_year,
                                    Round.month == next_month,
                                )
                            ).scalar_one()
                            svc.set_status(
                                round_id=new_rnd.id,
                                status_=RoundStatus.registration_open,
                            )
                            logger.info("Auto-created round %d-%02d at 8PM", next_year, next_month)
                        except Exception:
                            logger.exception("Failed to create next round after %s at 8PM", rnd.id)
                    else:
                        logger.info("Next round %d-%02d already exists, skipping", next_year, next_month)

    except Exception:
        logger.exception("Round lifecycle tick failed")
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = BackgroundScheduler()
    scheduler.add_job(_tick_round_lifecycle, "interval", minutes=1, id="round_lifecycle")
    scheduler.start()
    logger.info("Round lifecycle scheduler started")
    yield
    scheduler.shutdown()
    logger.info("Round lifecycle scheduler stopped")


def create_app() -> FastAPI:
    configure_logging()

    app = FastAPI(title=settings.app_name, lifespan=lifespan)

    allow_origins = [o.strip() for o in settings.cors_allow_origins.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allow_origins or ["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(root_router)
    app.include_router(health_router)
    app.include_router(api_router, prefix=settings.api_prefix)

    from app.admin import setup_admin
    setup_admin(app)

    return app


app = create_app()
