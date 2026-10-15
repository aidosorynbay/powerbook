from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "powerbook-api"
    environment: str = "local"
    log_level: str = "INFO"
    api_prefix: str = "/api"

    # CORS (frontend)
    cors_allow_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # Database
    # Example: postgresql+psycopg://user:pass@localhost:5432/powerbook
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/powerbook"
    db_echo: bool = False

    # Auth / JWT
    jwt_secret_key: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_access_token_exp_minutes: int = 60 * 24 * 7  # 7 days
    # How long a sign-in lasts. The app swaps the token for a fresh one once a day while it is used, so a reader is
    # never sent back to «Вход» unless they press «Выйти» or the password changes (2026-10-15: 36 of 69 returning
    # members met the login page in two weeks when a token lived 7 days). The longer of this and the minutes above wins.
    jwt_session_days: int = 400

    # Reading without an account in the library hall (the front page's «Начать читать»). False turns it off at once.
    guest_room_enabled: bool = True

    # Library (uploaded PDF/EPUB files)
    # Bind-mounted from the host so books survive container rebuilds.
    library_storage_dir: str = "/app/storage/library"
    library_max_file_mb: int = 60
    library_quota_mb: int = 1024

    # Telegram bot (login widget / password reset)
    telegram_bot_token: str = ""
    telegram_bot_username: str = "PowerbookKZBot"
    # Who the bot tells about what waits in /admin (app/services/admin_ping.py):
    # numeric chat ids, comma-separated. Empty means nobody.
    telegram_admin_chat_ids: str = ""

    # «Хей, как вы?» to readers quiet in the circle (app/services/checkins.py).
    # Whose account the founder's answers come from: a username; empty means the
    # first superadmin. The automatic word speaks as CHECKIN_VOICE: "powerbook"
    # (the product, as Duolingo does) or "founder" (his name and photo).
    # CHECKIN_AUTO=false brings back the founder's morning ✅.
    checkin_from_username: str = ""
    checkin_auto: bool = True
    checkin_voice: str = "powerbook"
    # Messages between readers (app/services/buddy_chat.py): built and lawful, but parked until the
    # club has 80+ active readers (the council and the founder, 2026-10-15). Off: its routes are 404.
    buddy_chat_enabled: bool = False

    # Google Books API key for cover lookups (app/services/covers.py). Empty
    # means the keyless public feed, which works but searches less well.
    google_books_api_key: str = ""

    # Claude (Anthropic API) for the reading summaries and the book facts
    # pass. Empty means those features say "not switched on yet" and
    # everything else works without them.
    anthropic_api_key: str = ""
    ai_model: str = "claude-opus-5"
    # The background pass that asks Claude (with web search) for each
    # book's Goodreads/LiveLib rating and readers' verdict. Costs money per
    # book, so it stays off until switched on.
    ai_book_facts: bool = False
    # Background fetching of ratings and descriptions from the free
    # catalogues (Google Books, Open Library, Wikipedia).
    book_facts_enabled: bool = True

    # DeepSeek (OpenAI-compatible API) for every AI feature when its key is
    # set: the reading letters, the round review and talking about a book.
    # Claude stays for the web-search facts pass. deepseek-chat and
    # deepseek-reasoner were retired on 2026-07-24; deepseek-flash is
    # V4.1-Flash. app/services/llm.py picks the provider.
    deepseek_api_key: str = ""
    deepseek_model: str = "deepseek-flash"
    deepseek_base_url: str = "https://api.deepseek.com"
    # Messages a reader may send about books in one day.
    ai_chat_daily_limit: int = 40

    # Sentry error monitoring (app/core/sentry.py). Empty DSN means off.
    # SENTRY_RELEASE is the git commit, passed in by the deploy.
    sentry_dsn: str = ""
    sentry_environment: str = "production"
    sentry_release: str = ""
    sentry_traces_sample_rate: float = 0.1

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()


