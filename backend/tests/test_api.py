import asyncio

from httpx import ASGITransport, AsyncClient

from app.core.config import Settings
from app.llm.local import LocalPlanningModel
from app.main import create_app
from tests.fakes import FakeGoogleMapsClient


async def test_health_run_status_and_replayable_sse() -> None:
    maps = FakeGoogleMapsClient()
    app = create_app(
        settings=Settings(
            supabase_auth_required=False,
            openai_api_key=None,
            google_maps_api_key="fake",
            sse_heartbeat_seconds=5,
        ),
        planning_model=LocalPlanningModel(),
        maps_client=maps,
    )
    async with app.router.lifespan_context(app):
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://testserver",
        ) as client:
            health = await client.get("/health")
            assert health.status_code == 200
            assert set(health.json()["capabilities"]) == {
                "planning_model",
                "llm_configured",
                "google_maps_configured",
                    "supabase_configured",
                    "run_store",
                    "agent_runtime",
                    "langsmith_tracing",
                }

            created = await client.post(
                "/api/v1/trips/runs",
                json={
                    "message": (
                        "Plan a relaxed 3-day trip from Lahore to Islamabad for two people "
                        "under $1500. We like food and culture."
                    )
                },
            )
            assert created.status_code == 202
            run_id = created.json()["run_id"]

            snapshot = None
            for _ in range(100):
                snapshot = await client.get(f"/api/v1/runs/{run_id}")
                if snapshot.json()["status"] in {"completed", "failed"}:
                    break
                await asyncio.sleep(0.01)

            assert snapshot is not None
            assert snapshot.json()["status"] == "completed"
            assert snapshot.json()["result"]["status"] == "valid"

            events = await client.get(f"/api/v1/runs/{run_id}/events")
            assert events.status_code == 200
            assert "event: run.started" in events.text
            assert "event: agent.started" in events.text
            assert "event: run.completed" in events.text

            replay = await client.get(
                f"/api/v1/runs/{run_id}/events",
                headers={"Last-Event-ID": "1"},
            )
            assert "id: 1\n" not in replay.text
            assert "event: run.completed" in replay.text

    assert maps.closed is True


async def test_api_returns_mcq_clarification_payload() -> None:
    app = create_app(
        settings=Settings(
            openai_api_key=None,
            google_maps_api_key="fake",
            supabase_auth_required=False,
        ),
        planning_model=LocalPlanningModel(),
        maps_client=FakeGoogleMapsClient(),
    )
    async with app.router.lifespan_context(app):
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://testserver",
        ) as client:
            created = await client.post(
                "/api/v1/trips/runs",
                json={"message": "Plan a trip to Islamabad"},
            )
            run_id = created.json()["run_id"]
            for _ in range(100):
                snapshot = await client.get(f"/api/v1/runs/{run_id}")
                if snapshot.json()["status"] == "needs_clarification":
                    break
                await asyncio.sleep(0.01)

            payload = snapshot.json()
            assert payload["status"] == "needs_clarification"
            assert payload["result"]["ui_schema_version"] == "1"
            questions = {question["id"]: question for question in payload["result"]["questions"]}
            assert questions["travelers"]["kind"] == "single_select"
            assert questions["travelers"]["options"]
            assert "interests" not in questions
            assert "pace" not in questions
            assert "budget_band" not in questions


async def test_api_completes_exploratory_hotel_intake_without_unnecessary_questions() -> None:
    app = create_app(
        settings=Settings(
            openai_api_key=None,
            google_maps_api_key="fake",
            supabase_auth_required=False,
        ),
        planning_model=LocalPlanningModel(),
        maps_client=FakeGoogleMapsClient(),
    )
    async with app.router.lifespan_context(app):
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://testserver",
        ) as client:
            created = await client.post(
                "/api/v1/trips/runs",
                json={"message": "Find hotels near Dubai Mall"},
            )
            run_id = created.json()["run_id"]
            for _ in range(100):
                snapshot = await client.get(f"/api/v1/runs/{run_id}")
                if snapshot.json()["status"] in {"completed", "failed"}:
                    break
                await asyncio.sleep(0.01)

            payload = snapshot.json()
            assert payload["status"] == "completed"
            assert payload["result"]["mode"] == "exploratory"
            assert payload["result"]["constraints"]["destination_query"] == "Dubai Mall"
            assert payload["result"]["properties"]
            property_result = payload["result"]["properties"][0]
            assert property_result["provider_ids"]["google_places"] == "stay-1"
            assert property_result["provider_ids"]["tripvlog_dummy"]
            assert property_result["offers"] == []
            assert "dummy data" in payload["result"]["warnings"][0]
