from app.core.config import Settings
from app.graph.builder import build_trip_graph
from app.llm.local import LocalPlanningModel
from app.schemas.trip import PlanTripRequest
from tests.fakes import FakeGoogleMapsClient


async def test_graph_pauses_for_structured_clarification() -> None:
    maps = FakeGoogleMapsClient()
    graph = build_trip_graph(
        settings=Settings(
            openai_api_key=None,
            google_maps_api_key="fake",
            supabase_auth_required=False,
        ),
        model=LocalPlanningModel(),
        maps=maps,
    )

    result = await graph.ainvoke({"request": PlanTripRequest(message="Plan a trip")})

    assert result["clarifications"]
    assert "destination" in {question.id for question in result["clarifications"]}
    assert "scope" not in result
    assert maps.max_active_searches == 0


async def test_full_graph_uses_parallel_grounded_research_and_builds_routes() -> None:
    maps = FakeGoogleMapsClient()
    graph = build_trip_graph(
        settings=Settings(
            openai_api_key=None,
            google_maps_api_key="fake",
            supabase_auth_required=False,
        ),
        model=LocalPlanningModel(),
        maps=maps,
    )
    request = PlanTripRequest(
        message=(
            "Plan a relaxed 3-day trip from Lahore to Islamabad for two people "
            "under $1500. We like food and culture."
        )
    )

    result = await graph.ainvoke({"request": request})
    plan = result["plan"]

    assert maps.max_active_searches >= 2
    assert plan.status == "valid"
    assert plan.selected_stay.provider_id == "stay-1"
    assert {stop.place.provider_id for day in plan.itinerary for stop in day.stops} == {
        "activity-food",
        "activity-culture",
    }
    assert plan.itinerary[0].route.encoded_polyline == "test-polyline"
    assert plan.trip_overview_route.origin.label == "Lahore"
    assert plan.trip_overview_route.destination.label == "Lahore"
    assert plan.budget.is_within_budget is None
