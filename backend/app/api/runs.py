import json
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from fastapi.responses import StreamingResponse

from app.api.dependencies import get_current_user, get_run_manager
from app.harness.runs import InMemoryRunManager, RunNotFoundError
from app.schemas.events import CreateRunResponse, RunSnapshot
from app.schemas.trip import PlanTripRequest
from app.supabase import AuthenticatedUser, AuthenticationError, PersistenceError

router = APIRouter(prefix="/api/v1", tags=["trip planning"])


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(
    conversation_id: UUID,
    manager: Annotated[InMemoryRunManager, Depends(get_run_manager)],
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
) -> Response:
    try:
        deleted = await manager.delete_conversation(conversation_id, user.id)
    except PersistenceError as exc:
        raise HTTPException(status_code=502, detail="Could not delete conversation") from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/trips/runs",
    response_model=CreateRunResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_trip_run(
    payload: PlanTripRequest,
    response: Response,
    manager: Annotated[InMemoryRunManager, Depends(get_run_manager)],
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
) -> CreateRunResponse:
    try:
        snapshot = await manager.create(payload, user_id=user.id)
    except AuthenticationError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PersistenceError as exc:
        raise HTTPException(status_code=502, detail="Could not persist planning run") from exc
    events_url = f"/api/v1/runs/{snapshot.run_id}/events"
    status_url = f"/api/v1/runs/{snapshot.run_id}"
    response.headers["Location"] = status_url
    return CreateRunResponse(
        run_id=snapshot.run_id,
        conversation_id=snapshot.conversation_id,
        status=snapshot.status,
        events_url=events_url,
        status_url=status_url,
    )


@router.get("/runs/{run_id}", response_model=RunSnapshot)
async def get_trip_run(
    run_id: UUID,
    manager: Annotated[InMemoryRunManager, Depends(get_run_manager)],
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
) -> RunSnapshot:
    try:
        if not await manager.owns_run(run_id, user.id):
            raise HTTPException(status_code=404, detail="Run not found or expired")
        return await manager.get(run_id)
    except RunNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Run not found or expired") from exc
    except PersistenceError as exc:
        raise HTTPException(status_code=502, detail="Could not read planning run") from exc


@router.get("/runs/{run_id}/events")
async def stream_trip_run(
    run_id: UUID,
    manager: Annotated[InMemoryRunManager, Depends(get_run_manager)],
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    last_event_id: Annotated[str | None, Header(alias="Last-Event-ID")] = None,
) -> StreamingResponse:
    try:
        if not await manager.owns_run(run_id, user.id):
            raise HTTPException(status_code=404, detail="Run not found or expired")
        await manager.get(run_id)
    except RunNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Run not found or expired") from exc
    except PersistenceError as exc:
        raise HTTPException(status_code=502, detail="Could not read planning run") from exc

    try:
        after_sequence = int(last_event_id or "0")
    except ValueError:
        after_sequence = 0

    async def event_stream():
        yield "retry: 3000\n\n"
        async for event in manager.subscribe(run_id, after_sequence=after_sequence):
            if event is None:
                yield ": keep-alive\n\n"
                continue
            data = json.dumps(event.model_dump(mode="json"), separators=(",", ":"))
            yield f"id: {event.sequence}\nevent: {event.type}\ndata: {data}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
