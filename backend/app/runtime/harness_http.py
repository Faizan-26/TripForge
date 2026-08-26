import json
import re
from collections.abc import AsyncIterator
from typing import Any
from uuid import UUID

import httpx

from app.runtime.base import RuntimeCompleted, RuntimeProgress, RuntimeUpdate
from app.schemas.trip import PlanTripRequest


class HarnessProtocolError(RuntimeError):
    pass


class HarnessExecutionError(HarnessProtocolError):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.public_message = message


ACTIVITY_SCHEMA_VERSION = "1"
PUBLIC_ACTIVITY_TYPES = {
    "agent.started",
    "agent.progress",
    "agent.completed",
    "answer.preparing",
    "tool.started",
    "tool.completed",
    "tool.failed",
}
_SECRET_KEY = re.compile(r"authorization|api[_-]?key|password|secret|token", re.I)


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

    if not isinstance(payload, dict):
        raise HarnessProtocolError("Harness returned an unsupported update")

    kind = payload.get("kind")
    if kind == "progress":
        event_type = payload.get("type")
        supported = event_type in PUBLIC_ACTIVITY_TYPES
        if not supported:
            event_type = "agent.progress"
        return RuntimeProgress(
            type=event_type,
            agent=_bounded_string(payload.get("agent"), 80),
            message=(
                _bounded_string(payload.get("message"), 300) or "Planning update"
                if supported
                else "Planning update"
            ),
            data=_public_activity_data(event_type, payload.get("data")),
        )
    if kind == "completed" and isinstance(payload.get("state"), dict):
        return RuntimeCompleted(state=payload["state"])
    if kind == "failed":
        error = payload.get("error")
        message = error.get("message") if isinstance(error, dict) else None
        raise HarnessExecutionError(
            message if isinstance(message, str) else "Harness execution failed"
        )
    raise HarnessProtocolError("Harness returned an unsupported update")


def _public_activity_data(event_type: str, value: Any) -> dict[str, Any]:
    source = value if isinstance(value, dict) else {}
    allowed_by_type = {
        "agent.started": {"runtime", "turn", "step"},
        "agent.progress": {"runtime", "turn", "step"},
        "agent.completed": {"runtime", "turn", "step", "duration_ms"},
        "answer.preparing": {"turn", "step"},
        "tool.started": {"tool", "call_id", "arguments"},
        "tool.completed": {"tool", "call_id", "status", "duration_ms"},
        "tool.failed": {"tool", "call_id", "status", "duration_ms", "error"},
    }
    result: dict[str, Any] = {"activity_schema_version": ACTIVITY_SCHEMA_VERSION}
    for key in allowed_by_type.get(event_type, set()):
        if key in source:
            result[key] = _sanitize_public_value(source[key])
    return result


def _sanitize_public_value(value: Any, depth: int = 0) -> Any:
    if depth > 4:
        return "[truncated]"
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return value[:300]
    if isinstance(value, list):
        return [_sanitize_public_value(item, depth + 1) for item in value[:20]]
    if isinstance(value, dict):
        return {
            str(key)[:80]: (
                "[redacted]"
                if _SECRET_KEY.search(str(key))
                else _sanitize_public_value(item, depth + 1)
            )
            for key, item in list(value.items())[:30]
        }
    return str(value)[:100]


def _bounded_string(value: Any, limit: int) -> str | None:
    return value[:limit] if isinstance(value, str) and value else None
