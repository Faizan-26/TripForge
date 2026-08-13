from datetime import date

from app.agents.hotel_search import HotelSearchAgent
from app.llm.local import LocalPlanningModel
from app.schemas.hotel import HotelSearchConstraints, HotelSearchMode
from app.schemas.trip import PlanTripRequest
from app.tools.tripvlog_dummy import TripVlogDummyClient
from tests.fakes import FakeGoogleMapsClient


async def test_hotel_agent_emits_google_grounded_tripvlog_shaped_results() -> None:
    events: list[dict] = []
    model = LocalPlanningModel()
    draft = await model.extract_trip("Find hotels near Dubai Mall")
    agent = HotelSearchAgent(
        maps=FakeGoogleMapsClient(),
        tripvlog=TripVlogDummyClient(),
        max_results=8,
    )

    output = await agent(
        {
            "request": PlanTripRequest(message="Find hotels near Dubai Mall"),
            "draft": draft,
            "hotel_search": draft.hotel_search,
        },
        events.append,
    )

    result = output["hotel_result"]
    assert result.mode == HotelSearchMode.EXPLORATORY
    assert result.properties[0].name == "Provider Test Hotel"
    assert result.properties[0].provider_ids == {
        "tripvlog_dummy": result.properties[0].property_id,
        "google_places": "stay-1",
    }
    assert result.properties[0].review_summary is not None
    assert result.properties[0].amenities
    assert result.properties[0].images[0].attribution == "TripVlog dummy data"
    assert [event["type"] for event in events] == [
        "agent.started",
        "tool.started",
        "tool.completed",
        "agent.completed",
    ]


async def test_dummy_tripvlog_bookable_response_is_deterministic_except_timestamps() -> None:
    maps = FakeGoogleMapsClient()
    places = await maps.search_places(
        "hotels near Rome",
        included_type="lodging",
    )
    constraints = HotelSearchConstraints(
        destination_query="Rome",
        check_in=date(2027, 6, 10),
        check_out=date(2027, 6, 14),
        adults=2,
        rooms=1,
        max_total_price=800,
    )
    client = TripVlogDummyClient()

    first = await client.enrich_properties(places, constraints, HotelSearchMode.BOOKABLE)
    second = await client.enrich_properties(places, constraints, HotelSearchMode.BOOKABLE)
    first_property = first.data.results[0]
    second_property = second.data.results[0]

    assert first_property.property_id == second_property.property_id
    assert first_property.provider_property_id == "stay-1"
    assert first_property.price is not None
    assert second_property.price is not None
    assert first_property.price.price_per_night == second_property.price.price_per_night
    assert first_property.price.total_price <= 800
