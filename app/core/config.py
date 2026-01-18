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

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()

