from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/vibe2ship"
    REDIS_URL: str = "redis://localhost:6379/0"

    @property
    def async_database_url(self) -> str:
        """Render/Railway give postgres:// — swap to asyncpg driver."""
        url = self.DATABASE_URL
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+asyncpg://", 1)
        elif url.startswith("postgresql://") and "+asyncpg" not in url:
            url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        return url

    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = "http://localhost:8000/api/auth/google/callback"

    OPENAI_API_KEY: str = ""
    GEMINI_API_KEY: str = ""
    GEMINI_API_KEYS: str = ""

    # NVIDIA NIM API — the actual working provider
    NVIDIA_API_KEY: str = ""
    NVIDIA_BASE_URL: str = "https://integrate.api.nvidia.com/v1"
    NVIDIA_MODEL: str = "meta/llama-3.3-70b-instruct"

    # Unified model name used across the app
    LLM_MODEL: str = ""  # auto-resolved below

    SECRET_KEY: str = "change-me-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60

    # Comma-separated emails allowed to view the admin analytics dashboard.
    # Defaults to the project owner; override via env in production.
    ADMIN_EMAILS: str = "mj.prajnan@gmail.com"

    # LLM provider: "nvidia" (default), "gemini", or "mock"
    LLM_PROVIDER: str = "nvidia"

    FRONTEND_URL: str = "http://localhost:5173"

    # DEBUG gates dev-only behaviour: API docs, permissive CORS, verbose errors,
    # and insecure-transport OAuth. MUST be false in production.
    DEBUG: bool = True

    # Comma-separated allowed origins for production CORS (used when DEBUG=false).
    CORS_ALLOW_ORIGINS: str = ""

    # DB connection pool bounds (avoid unbounded connections under load).
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20

    @property
    def admin_emails(self) -> set[str]:
        """Lowercased set of admin emails for case-insensitive matching."""
        return {e.strip().lower() for e in self.ADMIN_EMAILS.split(",") if e.strip()}

    @property
    def cors_origins(self) -> list[str]:
        origins = [o.strip() for o in self.CORS_ALLOW_ORIGINS.split(",") if o.strip()]
        if self.FRONTEND_URL and self.FRONTEND_URL not in origins:
            origins.append(self.FRONTEND_URL)
        return origins

    @property
    def active_model(self) -> str:
        if self.LLM_MODEL:
            return self.LLM_MODEL
        if self.NVIDIA_API_KEY:
            return self.NVIDIA_MODEL
        return "gemini-2.0-flash"

    @property
    def active_api_key(self) -> str:
        return self.NVIDIA_API_KEY or self.GEMINI_API_KEY or self.OPENAI_API_KEY

    @property
    def gemini_keys(self) -> list[str]:
        keys: list[str] = []
        for raw in [self.GEMINI_API_KEY, *self.GEMINI_API_KEYS.split(",")]:
            k = raw.strip()
            if k and k not in keys:
                keys.append(k)
        return keys


settings = Settings()
