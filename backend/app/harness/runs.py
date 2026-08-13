import asyncio
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel

from app.schemas.events import RunEvent, RunSnapshot, RunStatus
from app.schemas.trip import PlanTripRequest
from app.supabase import TripRepository

logger = logging.getLogger(__name__)
DEV_USER_ID = UUID("00000000-0000-0000-0000-000000000001")


@dataclass
class RunRecord:
    run_id: UUID
    conversation_id: UUID
    user_id: UUID
    request: PlanTripRequest
    status: RunStatus = RunStatus.QUEUED
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    events: list[RunEvent] = field(default_factory=list)
    result: dict[str, Any] | None = None
    error: str | None = None
    condition: asyncio.Condition = field(default_factory=asyncio.Condition)
    task: asyncio.Task[None] | None = None

    def snapshot(self) -> RunSnapshot:
        return RunSnapshot(
            run_id=self.run_id,
            conversation_id=self.conversation_id,
            status=self.status,
            created_at=self.created_at,
            updated_at=self.updated_at,
            parent_run_id=self.request.parent_run_id,
            result=self.result,
            error=self.error,
        )


class RunNotFoundError(KeyError):
    pass


class InMemoryRunManager:
    """Single-process run store with replayable event history.

    Replace this with durable storage before running multiple API workers.
    """

    def __init__(
        self,
        graph: Any,
        *,
        retention_seconds: int,
        heartbeat_seconds: int,
        repository: TripRepository | None = None,
    ) -> None:
        self._graph = graph
        self._retention = timedelta(seconds=retention_seconds)
        self.heartbeat_seconds = heartbeat_seconds
        self._records: dict[UUID, RunRecord] = {}
        self._lock = asyncio.Lock()
        self._repository = repository

    async def create(
        self,
        request: PlanTripRequest,
        *,
        user_id: UUID = DEV_USER_ID,
    ) -> RunSnapshot:
        await self._remove_expired()
        run_id = uuid4()
        conversation_id = request.conversation_id or uuid4()
        if self._repository:
            conversation_id = await self._repository.prepare_run(
                user_id=user_id, run_id=run_id, request=request
            )
        record = RunRecord(
            run_id=run_id,
            conversation_id=conversation_id,
            user_id=user_id,
            request=request,
        )
        async with self._lock:
            self._records[record.run_id] = record
        record.task = asyncio.create_task(
            self._execute_after_response(record),
            name=f"trip-run-{record.run_id}",
        )
        return record.snapshot()

    async def get(self, run_id: UUID) -> RunSnapshot:
        record = self._records.get(run_id)
        if record:
            return record.snapshot()
        if self._repository:
            snapshot = await self._repository.get_run(run_id)
            if snapshot:
                return snapshot
        raise RunNotFoundError(str(run_id))

    async def owns_run(self, run_id: UUID, user_id: UUID) -> bool:
        record = self._records.get(run_id)
        if record:
            return record.user_id == user_id
        return bool(
            self._repository
            and await self._repository.owns_run(user_id=user_id, run_id=run_id)
        )

    async def subscribe(
        self,
        run_id: UUID,
        *,
        after_sequence: int = 0,
    ) -> AsyncIterator[RunEvent | None]:
        record = self._records.get(run_id)
        if record is None:
            if not self._repository:
                raise RunNotFoundError(str(run_id))
            for event in await self._repository.list_events(
                run_id, after_sequence=max(after_sequence, 0)
            ):
                yield event
            return
        cursor = max(after_sequence, 0)
        while True:
            heartbeat = False
            terminal = False
            next_events: list[RunEvent] = []
            async with record.condition:
                next_events = [event for event in record.events if event.sequence > cursor]
                terminal = record.status in {
                    RunStatus.NEEDS_CLARIFICATION,
                    RunStatus.COMPLETED,
                    RunStatus.FAILED,
                }
                if not next_events and not terminal:
                    try:
                        await asyncio.wait_for(
                            record.condition.wait(), timeout=self.heartbeat_seconds
                        )
                    except TimeoutError:
                        heartbeat = True
            if heartbeat:
                yield None
                continue
            for event in next_events:
                cursor = event.sequence
                yield event
            if terminal and not [event for event in record.events if event.sequence > cursor]:
                return

    async def close(self) -> None:
        tasks = [record.task for record in self._records.values() if record.task]
        for task in tasks:
            if task and not task.done():
                task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _execute_after_response(self, record: RunRecord) -> None:
        # Give the API handler a scheduling turn to send its 202 response before
        # LangGraph begins CPU-bound graph setup.
        await asyncio.sleep(0.001)
        await self._execute(record)

    async def _execute(self, record: RunRecord) -> None:
        final_state: dict[str, Any] = {}
        try:
            await self._set_status(record, RunStatus.RUNNING)
            if self._repository:
                await self._repository.update_run(
                    record.run_id, status="running", started_at=datetime.now(UTC).isoformat()
                )
            await self._publish(
                record,
                event_type="run.started",
                message="Trip planning started",
                data={
                    "parent_run_id": (
                        str(record.request.parent_run_id)
                        if record.request.parent_run_id
                        else None
                    )
                },
            )
            async for part in self._graph.astream(
                {"request": record.request},
                stream_mode=["custom", "values"],
                version="v2",
            ):
                if part["type"] == "custom":
                    payload = part["data"]
                    await self._publish(
                        record,
                        event_type=payload.get("type", "run.progress"),
                        agent=payload.get("agent"),
                        message=payload.get("message", "Planning update"),
                        data=_jsonable(payload.get("data", {})),
                    )
                elif part["type"] == "values":
                    final_state = part["data"]

            if final_state.get("clarifications"):
                record.result = {
                    "draft": _jsonable(final_state.get("draft")),
                    "questions": _jsonable(final_state["clarifications"]),
                }
                await self._set_status(record, RunStatus.NEEDS_CLARIFICATION)
                if self._repository:
                    await self._repository.save_result(
                        conversation_id=record.conversation_id,
                        run_id=record.run_id,
                        result=record.result,
                        needs_clarification=True,
                    )
                    await self._repository.update_run(
                        record.run_id,
                        status="needs_clarification",
                        completed_at=datetime.now(UTC).isoformat(),
                    )
                await self._publish(
                    record,
                    event_type="run.paused",
                    message="Trip planning is waiting for clarification",
                    data=record.result,
                )
            elif final_state.get("plan"):
                record.result = _jsonable(final_state["plan"])
                await self._set_status(record, RunStatus.COMPLETED)
                if self._repository:
                    await self._repository.save_result(
                        conversation_id=record.conversation_id,
                        run_id=record.run_id,
                        result=record.result,
                        needs_clarification=False,
                    )
                    await self._repository.update_run(
                        record.run_id,
                        status="completed",
                        completed_at=datetime.now(UTC).isoformat(),
                    )
                await self._publish(
                    record,
                    event_type="run.completed",
                    message="Trip planning completed",
                    data={"plan_status": record.result.get("status")},
                )
            else:
                raise RuntimeError("The graph finished without a plan or clarification request")
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Trip planning run %s failed", record.run_id)
            record.error = "The planning run failed. Check server logs for the provider error."
            await self._set_status(record, RunStatus.FAILED)
            if self._repository:
                try:
                    await self._repository.update_run(
                        record.run_id,
                        status="failed",
                        error_code="planning_failed",
                        error_message=record.error,
                        completed_at=datetime.now(UTC).isoformat(),
                    )
                except Exception:
                    logger.exception("Could not persist failure for run %s", record.run_id)
            try:
                await self._publish(
                    record,
                    event_type="run.failed",
                    message=record.error,
                )
            except Exception:
                logger.exception("Could not persist failure event for run %s", record.run_id)

    async def _publish(
        self,
        record: RunRecord,
        *,
        event_type: str,
        message: str,
        agent: str | None = None,
        data: dict[str, Any] | None = None,
    ) -> None:
        async with record.condition:
            event = RunEvent(
                sequence=len(record.events) + 1,
                run_id=record.run_id,
                type=event_type,
                agent=agent,
                message=message,
                data=data or {},
            )
            record.events.append(event)
            record.updated_at = datetime.now(UTC)
            record.condition.notify_all()
        if self._repository:
            await self._repository.add_event(
                conversation_id=record.conversation_id,
                run_id=record.run_id,
                event=event,
            )

    async def _set_status(self, record: RunRecord, status: RunStatus) -> None:
        async with record.condition:
            record.status = status
            record.updated_at = datetime.now(UTC)
            record.condition.notify_all()

    def _get_record(self, run_id: UUID) -> RunRecord:
        try:
            return self._records[run_id]
        except KeyError as exc:
            raise RunNotFoundError(str(run_id)) from exc

    async def _remove_expired(self) -> None:
        cutoff = datetime.now(UTC) - self._retention
        async with self._lock:
            expired = [
                run_id
                for run_id, record in self._records.items()
                if record.updated_at < cutoff
                and record.status
                in {
                    RunStatus.NEEDS_CLARIFICATION,
                    RunStatus.COMPLETED,
                    RunStatus.FAILED,
                }
            ]
            for run_id in expired:
                del self._records[run_id]


def _jsonable(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    if isinstance(value, (datetime, UUID)):
        return str(value)
    return value
