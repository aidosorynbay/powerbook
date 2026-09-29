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

    # Library (uploaded PDF/EPUB files)
    # Bind-mounted from the host so books survive container rebuilds.
    library_storage_dir: str = "/app/storage/library"
    library_max_file_mb: int = 60
    library_quota_mb: int = 1024

    # Telegram bot (login widget / password reset)
    telegram_bot_token: str = ""
    telegram_bot_username: str = "PowerbookKZBot"

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

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()


