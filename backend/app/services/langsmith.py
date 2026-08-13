"""LangSmith setup shared by the API and evaluation tooling."""

import os
from typing import Any

from app.core.config import Settings


def configure_langsmith(settings: Settings) -> bool:
    """Configure LangChain/LangGraph's built-in tracing from application settings.

    Returning a boolean makes this easy to expose in health checks and tests.
    No network call is made here; traces are sent asynchronously by LangSmith.
    """
    enabled = settings.langsmith_tracing and bool(
        settings.langsmith_api_key and settings.langsmith_api_key.get_secret_value()
    )
    os.environ["LANGSMITH_TRACING"] = "true" if enabled else "false"
    os.environ["LANGSMITH_PROJECT"] = settings.langsmith_project
    os.environ["LANGCHAIN_PROJECT"] = settings.langsmith_project
    os.environ["LANGSMITH_ENDPOINT"] = settings.langsmith_endpoint
    if enabled:
        os.environ["LANGSMITH_API_KEY"] = settings.langsmith_api_key.get_secret_value()
        if settings.langsmith_workspace_id:
            os.environ["LANGSMITH_WORKSPACE_ID"] = settings.langsmith_workspace_id
    return enabled


def trace_config(*, run_id: Any, conversation_id: Any, parent_run_id: Any = None) -> dict[str, Any]:
    """Metadata/tags shown on every top-level LangSmith trace."""
    return {
        "run_name": "tripforge.trip_plan",
        "tags": ["tripforge", "trip-planning"],
        "metadata": {
            "tripforge_run_id": str(run_id),
            "conversation_id": str(conversation_id),
            "parent_run_id": str(parent_run_id) if parent_run_id else None,
        },
    }
