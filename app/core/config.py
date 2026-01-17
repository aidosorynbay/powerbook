from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "powerbook-api"
    environment: str = "local"
    log_level: str = "INFO"
    api_prefix: str = "/api"

    # Database
    # Example: postgresql+psycopg://user:pass@localhost:5432/powerbook
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/powerbook"
    db_echo: bool = False

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()

