from datetime import UTC, date, datetime
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.common import Coordinates, LocationInput, LocationRef, Money, SourceRef
from app.schemas.events import CreateRunResponse, RunEvent, RunSnapshot, RunStatus
from app.schemas.trip import (
    BudgetSummary,
    ClarificationOption,
    ClarificationQuestion,
    CompatibilityResult,
    GooglePlacePayload,
    ItineraryAssignment,
    ItineraryDay,
    ItineraryDecision,
    ItineraryStop,
    MapRoute,
    PlaceCandidate,
    PlanTripRequest,
    ResearchResult,
    RouteLeg,
    ScopeDecision,
    TravelMode,
    TripPlan,
    TripRequestDraft,
    TripRequirements,
    TripScope,
    ValidationIssue,
)


def _location(label: str = "Islamabad") -> LocationRef:
    return LocationRef(
        label=label,
        formatted_address=f"{label}, Pakistan",
        place_id=f"place-{label.lower()}",
        coordinates=Coordinates(latitude=33.6844, longitude=73.0479),
        google_maps_uri="https://maps.google.com/example",
    )


def _place(kind: str = "activity") -> PlaceCandidate:
    return PlaceCandidate(
        provider_id=f"provider-{kind}",
        kind=kind,
        name=f"Test {kind.title()}",
        location=_location(f"Test {kind.title()}"),
        types=[kind],
        rating=4.5,
        user_rating_count=100,
        price_level="PRICE_LEVEL_MODERATE",
        website_uri="https://example.test",
        source=SourceRef(
            provider="google_places",
            provider_id=f"provider-{kind}",
            uri="https://maps.google.com/example",
        ),
    )


def _requirements() -> TripRequirements:
    return TripRequirements(
        destination="Islamabad",
        origin=LocationInput(
            label="Lahore",
            coordinates=Coordinates(latitude=31.5204, longitude=74.3587),
        ),
        travelers=2,
        duration_days=3,
        start_date=date(2027, 1, 10),
        end_date=date(2027, 1, 12),
        dates_flexible=False,
        budget_total=1500,
        budget_band="balanced",
        interests=["food", "culture"],
        preferences=["quiet hotel"],
        pace="balanced",
        travel_mode=TravelMode.DRIVE,
    )


def test_common_models_validate_and_serialize() -> None:
    location = LocationInput(address="Lahore, Pakistan")
    money = Money(amount=125.5, currency="USD")
    source = SourceRef(provider="user", provider_id="request-1")

    assert location.model_dump(mode="json")["address"] == "Lahore, Pakistan"
    assert money.model_dump(mode="json") == {"amount": 125.5, "currency": "USD"}
    assert source.provider == "user"

    with pytest.raises(ValidationError):
        LocationInput()
    with pytest.raises(ValidationError):
        Coordinates(latitude=91, longitude=0)
    with pytest.raises(ValidationError):
        Money(amount=-1, currency="USD")
    with pytest.raises(ValidationError):
        Money(amount=1, currency="usd")


def test_request_models_derive_dates_and_reject_invalid_ranges() -> None:
    draft = TripRequestDraft(
        destination="Islamabad",
        origin="Lahore",
        travelers=2,
        start_date=date(2027, 1, 10),
        end_date=date(2027, 1, 12),
        interests=["food"],
    )
    request = PlanTripRequest(
        message="Plan a trip to Islamabad",
        answers={"travelers": 2, "interests": ["food"]},
        origin={"address": "Lahore"},
    )

    assert draft.duration_days == 3
    assert request.origin is not None
    assert request.origin.address == "Lahore"

    with pytest.raises(ValidationError):
        TripRequestDraft(start_date=date(2027, 1, 12), end_date=date(2027, 1, 10))
    with pytest.raises(ValidationError):
        PlanTripRequest(message="hi")


def test_clarification_scope_and_research_models() -> None:
    option = ClarificationOption(
        value="balanced",
        label="Balanced",
        description="A comfortable daily pace",
    )
    question = ClarificationQuestion(
        id="pace",
        prompt="Choose a pace",
        kind="single_select",
        options=[option],
    )
    decision = ScopeDecision(
        trip_type="single_base",
        base_regions=["Islamabad"],
        rationale="A compact three-day trip.",
    )
    scope = TripScope(
        destination="Islamabad",
        trip_type=decision.trip_type,
        base_regions=decision.base_regions,
        max_day_trip_minutes=decision.max_day_trip_minutes,
        home_origin={"address": "Lahore"},
        rationale=decision.rationale,
    )
    research = ResearchResult(candidates=[_place()], warnings=["Dummy provider response"])
    compatibility = CompatibilityResult(
        selected_stay_id="provider-stay",
        compatible_activity_ids=["provider-activity"],
        distances_km={"provider-activity": 2.5},
    )

    assert question.options[0].value == "balanced"
    assert scope.base_regions == ["Islamabad"]
    assert research.candidates[0].source.provider_id == "provider-activity"
    assert compatibility.distances_km["provider-activity"] == 2.5


def test_itinerary_route_budget_and_validation_models_round_trip() -> None:
    assignment = ItineraryAssignment(
        day=1,
        title="Food and culture",
        activity_ids=["provider-activity"],
    )
    itinerary_decision = ItineraryDecision(days=[assignment])
    route = MapRoute(
        kind="daily_round_trip",
        day=1,
        origin=_location("Hotel"),
        destination=_location("Hotel"),
        ordered_stops=[_location("Museum")],
        legs=[
            RouteLeg(
                from_label="Hotel",
                to_label="Museum",
                distance_meters=1200,
                duration_seconds=360,
            )
        ],
        distance_meters=2400,
        duration_seconds=720,
        encoded_polyline="dummy-polyline",
        google_maps_url="https://www.google.com/maps/dir/?api=1",
        source=SourceRef(provider="google_routes", provider_id="route-1"),
    )
    stop = ItineraryStop(sequence=1, place=_place())
    day_plan = ItineraryDay(
        day=1,
        date=date(2027, 1, 10),
        title=assignment.title,
        stops=[stop],
        route=route,
    )
    budget = BudgetSummary(
        currency="USD",
        budget_total=1500,
        known_cost_total=0,
        coverage="unavailable",
        unknown_cost_categories=["accommodation", "activities", "transport"],
        notes=["Dummy test has no live prices."],
    )
    issue = ValidationIssue(
        code="budget.partial",
        message="Live prices are unavailable.",
        severity="warning",
        retry_nodes=["stay", "activity"],
    )
    plan = TripPlan(
        status="valid",
        requirements=_requirements(),
        scope=TripScope(
            destination="Islamabad",
            trip_type="single_base",
            base_regions=["Islamabad"],
            max_day_trip_minutes=180,
            home_origin={"address": "Lahore"},
            rationale="A compact test scope.",
        ),
        selected_stay=_place("stay"),
        itinerary=[day_plan],
        trip_overview_route=route.model_copy(update={"kind": "trip_overview", "day": None}),
        budget=budget,
        validation=[issue],
    )

    serialized = plan.model_dump(mode="json")
    restored = TripPlan.model_validate(serialized)

    assert itinerary_decision.days[0].activity_ids == ["provider-activity"]
    assert restored == plan
    assert restored.itinerary[0].route is not None
    assert restored.itinerary[0].route.legs[0].distance_meters == 1200


def test_google_place_payload_normalizes_name_and_coordinates() -> None:
    place = GooglePlacePayload(
        id="place-1",
        display_name="  Test Museum  ",
        latitude=33.68,
        longitude=73.04,
    )
    no_coordinates = GooglePlacePayload(id="place-2", display_name="Test Park")

    assert place.display_name == "Test Museum"
    assert place.coordinates() == Coordinates(latitude=33.68, longitude=73.04)
    assert no_coordinates.coordinates() is None

    with pytest.raises(ValidationError):
        GooglePlacePayload(id="place-3", display_name="   ")


def test_event_models_support_every_run_status() -> None:
    run_id = uuid4()
    now = datetime.now(UTC)
    event = RunEvent(
        sequence=1,
        run_id=run_id,
        type="run.started",
        message="Started",
        data={"dummy": True},
    )
    created = CreateRunResponse(
        run_id=run_id,
        conversation_id=uuid4(),
        status=RunStatus.QUEUED,
        events_url=f"/runs/{run_id}/events",
        status_url=f"/runs/{run_id}",
    )
    snapshots = [
            RunSnapshot(
                run_id=run_id,
                conversation_id=created.conversation_id,
            status=status,
            created_at=now,
            updated_at=now,
        )
        for status in RunStatus
    ]

    assert event.model_dump(mode="json")["data"] == {"dummy": True}
    assert created.status == RunStatus.QUEUED
    assert {snapshot.status for snapshot in snapshots} == set(RunStatus)
