from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_name: str = "TripForge API"
    app_env: str = "development"
    app_cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])

    openai_api_key: str | None = None
    openai_model: str = "gpt-5-mini"
    # Optional OpenAI-compatible endpoint, for example Groq or OpenRouter.
    openai_base_url: str | None = None

    # LangSmith observability/evaluation. Tracing stays disabled unless both
    # LANGSMITH_TRACING=true and LANGSMITH_API_KEY are provided.
    langsmith_tracing: bool = False
    langsmith_api_key: SecretStr | None = None
    langsmith_project: str = "tripforge"
    langsmith_endpoint: str = "https://api.smith.langchain.com"
    langsmith_workspace_id: str | None = None

    google_maps_api_key: str | None = None

    supabase_url: str | None = None
    supabase_publishable_key: str | None = None
    supabase_secret_key: SecretStr | None = None
    supabase_auth_required: bool = False

    run_retention_seconds: int = Field(default=3600, ge=60, le=86400)
    sse_heartbeat_seconds: int = Field(default=15, ge=5, le=60)
    max_research_results: int = Field(default=8, ge=1, le=20)
    max_activity_queries: int = Field(default=4, ge=1, le=8)

    @model_validator(mode="after")
    def validate_supabase_configuration(self) -> "Settings":
        if not self.supabase_auth_required:
            return self
        configured = (
            bool(self.supabase_url),
            bool(self.supabase_publishable_key),
            bool(self.supabase_secret_key and self.supabase_secret_key.get_secret_value()),
        )
        if any(configured) and not all(configured):
            raise ValueError(
                "SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SECRET_KEY "
                "must be configured together"
            )
        if not all(configured):
            raise ValueError("Supabase credentials are required when SUPABASE_AUTH_REQUIRED=true")
        if self.supabase_publishable_key and not self.supabase_publishable_key.startswith(
            "sb_publishable_"
        ):
            raise ValueError("SUPABASE_PUBLISHABLE_KEY must use the current sb_publishable_ key")
        if self.supabase_secret_key and not self.supabase_secret_key.get_secret_value().startswith(
            "sb_secret_"
        ):
            raise ValueError("SUPABASE_SECRET_KEY must use the current sb_secret_ key")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
