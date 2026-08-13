from typing import Annotated

from fastapi import Header, HTTPException, Request, status

from app.core.config import Settings
from app.harness.runs import InMemoryRunManager
from app.llm.base import PlanningModel
from app.supabase import (
    AuthenticatedUser,
    AuthenticationError,
    PersistenceError,
    SupabaseGateway,
)
from app.tools.google_maps import GoogleMapsClient


async def get_run_manager(request: Request) -> InMemoryRunManager:
    return request.app.state.run_manager


async def get_app_settings(request: Request) -> Settings:
    return request.app.state.settings


async def get_planning_model(request: Request) -> PlanningModel:
    return request.app.state.planning_model


async def get_maps_client(request: Request) -> GoogleMapsClient:
    return request.app.state.maps_client


async def get_current_user(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
) -> AuthenticatedUser:
    gateway: SupabaseGateway | None = request.app.state.supabase
    if gateway is None:
        if request.app.state.settings.supabase_auth_required:
            raise HTTPException(status_code=503, detail="Supabase is not configured")
        return AuthenticatedUser(id=request.app.state.dev_user_id)
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Supabase bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        return await gateway.authenticate(authorization.split(" ", 1)[1].strip())
    except AuthenticationError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except PersistenceError as exc:
        raise HTTPException(status_code=503, detail="Authentication service unavailable") from exc
