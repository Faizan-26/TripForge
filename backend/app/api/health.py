from typing import Annotated, Any

from fastapi import APIRouter, Depends

from app.api.dependencies import get_app_settings, get_maps_client, get_planning_model
from app.core.config import Settings
from app.llm.base import PlanningModel
from app.tools.google_maps import GoogleMapsClient

router = APIRouter(tags=["health"])


@router.get("/health")
async def health(
    settings: Annotated[Settings, Depends(get_app_settings)],
    model: Annotated[PlanningModel | None, Depends(get_planning_model)],
    maps: Annotated[GoogleMapsClient, Depends(get_maps_client)],
) -> dict[str, Any]:
    return {
        "status": "ok",
        "service": settings.app_name,
        "environment": settings.app_env,
        "capabilities": {
            "planning_model": model.name if model else "deepseek_harness",
            "llm_configured": (
                bool(settings.harness_service_token)
                if settings.agent_runtime == "deepseek"
                else bool(settings.openai_api_key)
            ),
            "google_maps_configured": maps.configured,
            "supabase_configured": bool(
                settings.supabase_url
                and settings.supabase_publishable_key
                and settings.supabase_secret_key
            ),
            "run_store": "in_memory_single_process",
            "agent_runtime": settings.agent_runtime,
            "langsmith_tracing": settings.langsmith_tracing
            and bool(settings.langsmith_api_key),
        },
    }
