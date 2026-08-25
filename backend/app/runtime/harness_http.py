import json
from collections.abc import AsyncIterator
from typing import Any
from uuid import UUID

import httpx

from app.runtime.base import RuntimeCompleted, RuntimeProgress, RuntimeUpdate
from app.schemas.trip import PlanTripRequest


class HarnessProtocolError(RuntimeError):
    pass


class HarnessHttpRuntime:
    """Client for the isolated TripForge DeepSeek Harness service."""

    def __init__(self, *, base_url: str, service_token: str, timeout_seconds: float) -> None:
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {service_token}"},
            timeout=httpx.Timeout(timeout_seconds, connect=10.0),
        )

    async def execute(
        self,
        request: PlanTripRequest,
        *,
        run_id: UUID,
        conversation_id: UUID,
    ) -> AsyncIterator[RuntimeUpdate]:
        body = {
            "run_id": str(run_id),
            "conversation_id": str(conversation_id),
            "parent_run_id": str(request.parent_run_id) if request.parent_run_id else None,
            "message": request.message,
            "payload": request.model_dump(mode="json", exclude={"message"}),
        }
        completed = False
        async with self._client.stream("POST", "/internal/v1/execute", json=body) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line:
                    continue
                update = _parse_update(line)
                if isinstance(update, RuntimeCompleted):
                    completed = True
                yield update
        if not completed:
            raise HarnessProtocolError("Harness stream ended without a completed update")

    async def close(self) -> None:
        await self._client.aclose()


def _parse_update(line: str) -> RuntimeUpdate:
    try:
        payload: dict[str, Any] = json.loads(line)
    except (json.JSONDecodeError, TypeError) as exc:
        raise HarnessProtocolError("Harness returned malformed NDJSON") from exc

    kind = payload.get("kind")
    if kind == "progress":
        return RuntimeProgress(
            type=payload.get("type", "run.progress"),
            agent=payload.get("agent"),
            message=payload.get("message", "Planning update"),
            data=payload.get("data", {}),
        )
    if kind == "completed" and isinstance(payload.get("state"), dict):
        return RuntimeCompleted(state=payload["state"])
    raise HarnessProtocolError("Harness returned an unsupported update")
