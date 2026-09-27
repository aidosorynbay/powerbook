import sentry_sdk

from app.core.config import settings


def init_sentry() -> None:
    """Start Sentry error monitoring. Does nothing until SENTRY_DSN is set.

    FastAPI, Starlette and logging are picked up automatically: unhandled
    exceptions in routes and every logger.exception (the round scheduler
    reports its failures that way) become Sentry issues.
    """
    if not settings.sentry_dsn:
        return

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        release=settings.sentry_release or None,
        # No IP addresses, cookies or auth headers, and no request bodies:
        # those carry passwords and readers' notes.
        send_default_pii=False,
        max_request_body_size="never",
        # Frame locals include the raw ASGI scope, whose headers (a list of
        # byte pairs) slip past the scrubber and would leak bearer tokens.
        include_local_variables=False,
        traces_sample_rate=settings.sentry_traces_sample_rate,
    )
