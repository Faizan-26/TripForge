import pytest

from app.schemas.common import Coordinates, LocationRef
from app.schemas.trip import ItineraryDay, TravelMode, TripRequirements
from app.services.budget import calculate_budget
from app.services.geo import haversine_km
from app.tools.google_maps import build_google_maps_directions_url


def test_haversine_distance_is_deterministic() -> None:
    lahore = Coordinates(latitude=31.5204, longitude=74.3587)
    islamabad = Coordinates(latitude=33.6844, longitude=73.0479)

    assert haversine_km(lahore, islamabad) == pytest.approx(270.3, abs=1.0)


def test_budget_never_claims_success_when_live_costs_are_unknown() -> None:
    trip = TripRequirements(
        destination="Islamabad",
        origin={"address": "Lahore"},
        travelers=2,
        duration_days=3,
        budget_total=1000,
        interests=["food"],
    )
    summary = calculate_budget(trip, None, [ItineraryDay(day=1, title="Day 1")])

    assert summary.coverage == "unavailable"
    assert summary.is_within_budget is None
    assert "accommodation" in summary.unknown_cost_categories


def test_maps_url_returns_to_origin() -> None:
    origin = LocationRef(label="Home", formatted_address="Lahore")
    stop = LocationRef(label="Hotel", place_id="hotel-id")
    url = build_google_maps_directions_url(origin, origin, [stop], TravelMode.DRIVE)

    assert "origin=Lahore" in url
    assert "destination=Lahore" in url
    assert "waypoints=Hotel" in url
