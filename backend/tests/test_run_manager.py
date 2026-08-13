import asyncio
from datetime import UTC, datetime
from uuid import uuid4

import pytest

from app.harness.runs import InMemoryRunManager, RunNotFoundError
from app.schemas.events import RunEvent, RunSnapshot, RunStatus
from app.schemas.trip import PlanTripRequest


class _FailingGraph:
    async def astream(self, inputs, *, stream_mode, version):
        if False:
            yield None
        raise RuntimeError("dummy graph failure")


class _CompletingGraph:
    async def astream(self, inputs, *, stream_mode, version):
        yield {
            "type": "values",
            "data": {
                "plan": {
                    "status": "valid",
                    "itinerary": [],
                    "budget": {},
                }
            },
        }


class _DurableReadRepository:
    def __init__(self, snapshot: RunSnapshot, events: list[RunEvent]) -> None:
        self.snapshot = snapshot
        self.events = events

    async def get_run(self, run_id):
        return self.snapshot if run_id == self.snapshot.run_id else None

    async def list_events(self, run_id, *, after_sequence):
        return [event for event in self.events if event.sequence > after_sequence]

    async def owns_run(self, *, user_id, run_id):
        return run_id == self.snapshot.run_id

    async def close(self):
        return None


async def test_run_manager_reports_sanitized_graph_failures_and_events() -> None:
    manager = InMemoryRunManager(
        _FailingGraph(),
        retention_seconds=60,
        heartbeat_seconds=1,
    )
    snapshot = await manager.create(PlanTripRequest(message="Plan a dummy trip"))
    try:
        for _ in range(100):
            snapshot = await manager.get(snapshot.run_id)
            if snapshot.status == RunStatus.FAILED:
                break
            await asyncio.sleep(0.01)

        events = [
            event
            async for event in manager.subscribe(snapshot.run_id)
            if event is not None
        ]
    finally:
        await manager.close()

    assert snapshot.status == RunStatus.FAILED
    assert snapshot.error is not None
    assert "dummy graph failure" not in snapshot.error
    assert [event.type for event in events] == ["run.started", "run.failed"]


async def test_live_subscriber_receives_terminal_event_before_stream_closes() -> None:
    manager = InMemoryRunManager(
        _CompletingGraph(),
        retention_seconds=60,
        heartbeat_seconds=1,
    )
    snapshot = await manager.create(PlanTripRequest(message="Plan a dummy trip"))
    try:
        events = [
            event
            async for event in manager.subscribe(snapshot.run_id)
            if event is not None
        ]
        completed = await manager.get(snapshot.run_id)
    finally:
        await manager.close()

    assert completed.status == RunStatus.COMPLETED
    assert events[-1].type == "run.completed"


async def test_run_manager_rejects_unknown_run_ids() -> None:
    manager = InMemoryRunManager(
        _FailingGraph(),
        retention_seconds=60,
        heartbeat_seconds=1,
    )
    try:
        with pytest.raises(RunNotFoundError):
            await manager.get(uuid4())
    finally:
        await manager.close()


async def test_run_manager_reads_completed_snapshot_and_events_after_restart() -> None:
    run_id = uuid4()
    now = datetime.now(UTC)
    snapshot = RunSnapshot(
        run_id=run_id,
        conversation_id=uuid4(),
        status=RunStatus.COMPLETED,
        created_at=now,
        updated_at=now,
        result={"status": "valid"},
    )
    event = RunEvent(
        sequence=1,
        run_id=run_id,
        type="run.completed",
        message="Trip planning completed",
    )
    manager = InMemoryRunManager(
        _FailingGraph(),
        retention_seconds=60,
        heartbeat_seconds=1,
        repository=_DurableReadRepository(snapshot, [event]),
    )
    try:
        restored = await manager.get(run_id)
        replayed = [item async for item in manager.subscribe(run_id)]
    finally:
        await manager.close()

    assert restored == snapshot
    assert replayed == [event]
