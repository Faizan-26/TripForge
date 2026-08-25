import inspect
from collections.abc import AsyncIterator
from typing import Any
from uuid import UUID

from app.runtime.base import RuntimeCompleted, RuntimeProgress, RuntimeUpdate
from app.schemas.trip import PlanTripRequest
from app.services.langsmith import trace_config


class LangGraphRuntime:
    """Compatibility adapter while TripForge migrates to DeepSeek Harness."""

    def __init__(self, graph: Any) -> None:
        self._graph = graph

    async def execute(
        self,
        request: PlanTripRequest,
        *,
        run_id: UUID,
        conversation_id: UUID,
    ) -> AsyncIterator[RuntimeUpdate]:
        final_state: dict[str, Any] = {}
        stream_kwargs: dict[str, Any] = {
            "stream_mode": ["custom", "values"],
            "version": "v2",
        }
        if "config" in inspect.signature(self._graph.astream).parameters:
            stream_kwargs["config"] = trace_config(
                run_id=run_id,
                conversation_id=conversation_id,
                parent_run_id=request.parent_run_id,
            )

        async for part in self._graph.astream({"request": request}, **stream_kwargs):
            if part["type"] == "custom":
                payload = part["data"]
                yield RuntimeProgress(
                    type=payload.get("type", "run.progress"),
                    agent=payload.get("agent"),
                    message=payload.get("message", "Planning update"),
                    data=payload.get("data", {}),
                )
            elif part["type"] == "values":
                final_state = part["data"]

        yield RuntimeCompleted(state=final_state)

    async def close(self) -> None:
        return None
