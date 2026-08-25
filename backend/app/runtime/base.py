from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any, Protocol
from uuid import UUID

from app.schemas.trip import PlanTripRequest


@dataclass(frozen=True)
class RuntimeProgress:
    type: str = "run.progress"
    agent: str | None = None
    message: str = "Planning update"
    data: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class RuntimeCompleted:
    state: dict[str, Any]


RuntimeUpdate = RuntimeProgress | RuntimeCompleted


class AgentRuntime(Protocol):
    """Framework-neutral execution boundary used by the product API."""

    async def execute(
        self,
        request: PlanTripRequest,
        *,
        run_id: UUID,
        conversation_id: UUID,
    ) -> AsyncIterator[RuntimeUpdate]: ...

    async def close(self) -> None: ...
