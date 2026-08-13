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


async def test_general_graph_returns_assistant_response_without_research() -> None:
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

    result = await graph.ainvoke({"request": PlanTripRequest(message="hiii")})

    assert result["draft"].intent == "GENERAL"
    assert result["general_result"].intent == "GENERAL"
    assert "find hotels" in result["general_result"].message.lower()
    assert result["clarifications"] == []
    assert "requirements" not in result
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


async def test_hotel_search_runs_grounded_property_pipeline() -> None:
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

    result = await graph.ainvoke(
        {"request": PlanTripRequest(message="Find hotels near Dubai Mall")}
    )

    assert result["draft"].intent == "HOTEL_SEARCH"
    assert result["hotel_search"].destination_query == "Dubai Mall"
    assert result["clarifications"] == []
    assert result["hotel_result"].mode == "exploratory"
    assert result["hotel_result"].properties
    property_result = result["hotel_result"].properties[0]
    assert property_result.provider_ids["google_places"] == "stay-1"
    assert property_result.provider_ids["tripvlog_dummy"]
    assert property_result.location.coordinates is not None
    assert property_result.offers == []
    assert "dummy data" in result["hotel_result"].warnings[0]
    assert "requirements" not in result
    assert maps.max_active_searches == 1


async def test_bookable_hotel_pipeline_adds_dummy_pricing_and_availability() -> None:
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

    result = await graph.ainvoke(
        {
            "request": PlanTripRequest(
                message=(
                    "Bookable hotels in Rome from June 10 to June 14 for two adults "
                    "under $800"
                )
            )
        }
    )

    assert result["clarifications"] == []
    assert result["hotel_result"].mode == "bookable"
    offer = result["hotel_result"].properties[0].offers[0]
    assert offer.provider == "tripvlog_dummy"
    assert offer.availability.status == "available"
    assert offer.availability.check_in is not None
    assert offer.availability.check_out is not None
    assert offer.pricing is not None
    assert offer.pricing.price_is_estimate is True
    assert offer.pricing.total.amount <= 800


async def test_full_trip_can_continue_without_optional_interests_or_budget() -> None:
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

    result = await graph.ainvoke(
        {
            "request": PlanTripRequest(
                message="Plan a 5-day trip from London to Paris for two people"
            )
        }
    )

    assert result["clarifications"] == []
    assert result["requirements"].interests == []
    assert result["activity_research"].candidates


async def test_selected_hotel_is_preserved_and_used_as_trip_base() -> None:
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
    hotel_search = await graph.ainvoke(
        {"request": PlanTripRequest(message="Find hotels near Dubai Mall")}
    )
    hotel = hotel_search["hotel_result"].properties[0]
    selected = {
        "search_id": hotel_search["hotel_result"].search_id,
        "property_id": hotel.property_id,
        "provider_ids": hotel.provider_ids,
        "name": hotel.name,
        "location": hotel.location,
    }

    result = await graph.ainvoke(
        {
            "request": PlanTripRequest(
                message=(
                    "Plan a 3-day trip from Abu Dhabi to Dubai for two people "
                    "using my selected hotel"
                ),
                selected_hotel=selected,
            )
        }
    )

    assert result["plan"].selected_stay.name == hotel.name
    assert result["plan"].selected_stay.provider_id == hotel.provider_ids["google_places"]
    assert result["requirements"].selected_hotel.property_id == hotel.property_id
