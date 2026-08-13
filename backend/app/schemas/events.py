from datetime import UTC, datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from pydantic import Field

from app.schemas.common import APIModel


class RunStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    NEEDS_CLARIFICATION = "needs_clarification"
    COMPLETED = "completed"
    FAILED = "failed"


class RunEvent(APIModel):
    sequence: int = Field(ge=1)
    run_id: UUID
    type: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))
    agent: str | None = None
    message: str
    data: dict[str, Any] = Field(default_factory=dict)


class CreateRunResponse(APIModel):
    run_id: UUID
    conversation_id: UUID
    status: RunStatus
    events_url: str
    status_url: str


class RunSnapshot(APIModel):
    run_id: UUID
    conversation_id: UUID
    status: RunStatus
    created_at: datetime
    updated_at: datetime
    parent_run_id: UUID | None = None
    result: dict[str, Any] | None = None
    error: str | None = None
