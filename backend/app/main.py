from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any
from uuid import UUID

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.api.places import router as places_router
from app.api.runs import router as runs_router
from app.core.config import Settings, get_settings
from app.graph.builder import build_trip_graph
from app.harness.runs import InMemoryRunManager
from app.llm.base import PlanningModel
from app.llm.factory import build_planning_model
from app.supabase import SupabaseGateway
from app.services.langsmith import configure_langsmith
from app.tools.google_maps import GoogleMapsClient


def create_app(
    *,
    settings: Settings | None = None,
    planning_model: PlanningModel | None = None,
    maps_client: GoogleMapsClient | None = None,
    graph: Any | None = None,
) -> FastAPI:
    app_settings = settings or get_settings()
    langsmith_enabled = configure_langsmith(app_settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        model = planning_model or build_planning_model(app_settings)
        maps = maps_client or GoogleMapsClient(app_settings.google_maps_api_key)
        compiled_graph = graph or build_trip_graph(
            settings=app_settings,
            model=model,
            maps=maps,
        )
        supabase = None
        if (
            app_settings.supabase_auth_required
            and app_settings.supabase_url
            and app_settings.supabase_publishable_key
            and app_settings.supabase_secret_key
        ):
            supabase = SupabaseGateway(app_settings)
        manager = InMemoryRunManager(
            compiled_graph,
            retention_seconds=app_settings.run_retention_seconds,
            heartbeat_seconds=app_settings.sse_heartbeat_seconds,
            repository=supabase,
        )
        app.state.settings = app_settings
        app.state.planning_model = model
        app.state.maps_client = maps
        app.state.run_manager = manager
        app.state.supabase = supabase
        app.state.langsmith_enabled = langsmith_enabled
        app.state.dev_user_id = UUID("00000000-0000-0000-0000-000000000001")
        yield
        await manager.close()
        if supabase:
            await supabase.close()
        await maps.close()

    app = FastAPI(
        title=app_settings.app_name,
        version="0.1.0",
        description="Observable, grounded multi-agent trip planning API",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=app_settings.app_cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Last-Event-ID"],
    )
    app.include_router(health_router)
    app.include_router(places_router)
    app.include_router(runs_router)
    return app
