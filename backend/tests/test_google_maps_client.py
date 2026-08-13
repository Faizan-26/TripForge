import json

import httpx
import pytest

from app.schemas.common import Coordinates, LocationRef
from app.schemas.trip import TravelMode
from app.tools.google_maps import (
    ExternalProviderError,
    GoogleMapsClient,
    ProviderNotConfiguredError,
)


async def test_places_request_and_response_are_normalized_without_network() -> None:
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(
            200,
            json={
                "places": [
                    {
                        "id": "hotel-1",
                        "displayName": {"text": "Dummy Hotel"},
                        "formattedAddress": "Blue Area, Islamabad",
                        "location": {"latitude": 33.71, "longitude": 73.055},
                        "rating": 4.4,
                        "userRatingCount": 120,
                        "googleMapsUri": "https://maps.google.com/dummy-hotel",
                        "websiteUri": "https://example.test/hotel",
                        "types": ["lodging"],
                        "priceLevel": "PRICE_LEVEL_MODERATE",
                        "businessStatus": "OPERATIONAL",
                        "nationalPhoneNumber": "051 1234567",
                        "internationalPhoneNumber": "+92 51 1234567",
                        "editorialSummary": {"text": "A central business hotel."},
                        "allowsDogs": True,
                        "servesBreakfast": True,
                        "accessibilityOptions": {
                            "wheelchairAccessibleEntrance": True,
                        },
                        "parkingOptions": {"freeParkingLot": True},
                        "regularOpeningHours": {
                            "openNow": True,
                            "weekdayDescriptions": ["Monday: Open 24 hours"],
                            "nextCloseTime": "2027-06-11T00:00:00Z",
                        },
                        "photos": [
                            {
                                "name": "places/hotel-1/photos/photo-1",
                                "widthPx": 1600,
                                "heightPx": 900,
                                "authorAttributions": [
                                    {
                                        "displayName": "Test Photographer",
                                        "uri": "https://maps.google.com/photographer",
                                    }
                                ],
                                "googleMapsUri": "https://maps.google.com/photo-1",
                            }
                        ],
                        "reviews": [
                            {
                                "name": "places/hotel-1/reviews/review-1",
                                "rating": 5,
                                "text": {"text": "Clean rooms and friendly staff."},
                                "relativePublishTimeDescription": "a month ago",
                                "publishTime": "2027-05-01T10:00:00Z",
                                "authorAttribution": {
                                    "displayName": "Test Traveler",
                                    "uri": "https://maps.google.com/traveler",
                                },
                                "googleMapsUri": "https://maps.google.com/review-1",
                            }
                        ],
                    }
                ]
            },
        )

    http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    maps = GoogleMapsClient("dummy-key", client=http_client)
    try:
        results = await maps.search_places(
            "hotels in Islamabad",
            max_results=3,
            included_type="lodging",
        )
    finally:
        await http_client.aclose()

    assert len(results) == 1
    assert results[0].id == "hotel-1"
    assert results[0].coordinates() == Coordinates(latitude=33.71, longitude=73.055)
    assert results[0].photos[0].author_name == "Test Photographer"
    assert results[0].reviews[0].text == "Clean rooms and friendly staff."
    assert results[0].opening_hours is not None
    assert results[0].opening_hours.open_now is True
    assert results[0].editorial_summary == "A central business hotel."
    assert results[0].amenities == [
        "Dogs allowed",
        "Breakfast available",
        "Wheelchair-accessible entrance",
        "Free parking lot",
    ]
    assert captured[0].headers["X-Goog-Api-Key"] == "dummy-key"
    assert "places.id" in captured[0].headers["X-Goog-FieldMask"]
    assert "places.photos" in captured[0].headers["X-Goog-FieldMask"]
    assert "places.reviews" in captured[0].headers["X-Goog-FieldMask"]
    assert json.loads(captured[0].content) == {
        "textQuery": "hotels in Islamabad",
        "pageSize": 3,
        "languageCode": "en",
        "includedType": "lodging",
    }


async def test_routes_request_reorders_dummy_waypoints_and_builds_legs() -> None:
    captured_body: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured_body.update(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "routes": [
                    {
                        "distanceMeters": 9000,
                        "duration": "1800s",
                        "polyline": {"encodedPolyline": "dummy-encoded-polyline"},
                        "optimizedIntermediateWaypointIndex": [1, 0],
                        "legs": [
                            {"distanceMeters": 3000, "duration": "600s"},
                            {"distanceMeters": 2500, "duration": "500s"},
                            {"distanceMeters": 3500, "duration": "700s"},
                        ],
                    }
                ]
            },
        )

    http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    maps = GoogleMapsClient("dummy-key", client=http_client)
    origin = LocationRef(label="Dummy Hotel", place_id="hotel-1")
    first = LocationRef(label="Dummy Museum", place_id="museum-1")
    second = LocationRef(label="Dummy Park", place_id="park-1")
    try:
        route = await maps.compute_round_trip(
            origin=origin,
            stops=[first, second],
            mode=TravelMode.DRIVE,
            kind="daily_round_trip",
            day=1,
        )
    finally:
        await http_client.aclose()

    assert captured_body["origin"] == {"placeId": "hotel-1"}
    assert captured_body["destination"] == {"placeId": "hotel-1"}
    assert captured_body["optimizeWaypointOrder"] is True
    assert [stop.place_id for stop in route.ordered_stops] == ["park-1", "museum-1"]
    assert route.distance_meters == 9000
    assert route.duration_seconds == 1800
    assert route.encoded_polyline == "dummy-encoded-polyline"
    assert [(leg.from_label, leg.to_label) for leg in route.legs] == [
        ("Dummy Hotel", "Dummy Park"),
        ("Dummy Park", "Dummy Museum"),
        ("Dummy Museum", "Dummy Hotel"),
    ]


async def test_place_photo_media_uses_private_key_and_bounded_dimensions() -> None:
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, content=b"image-data", headers={"content-type": "image/jpeg"})

    http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    maps = GoogleMapsClient("dummy-key", client=http_client)
    try:
        response = await maps.get_photo_media(
            "places/hotel-1/photos/photo-1",
            max_width_px=9999,
            max_height_px=0,
        )
    finally:
        await http_client.aclose()

    assert response.content == b"image-data"
    assert captured[0].headers["X-Goog-Api-Key"] == "dummy-key"
    assert captured[0].url.params["maxWidthPx"] == "4800"
    assert captured[0].url.params["maxHeightPx"] == "1"
    assert "dummy-key" not in str(captured[0].url)


async def test_unconfigured_and_failed_providers_return_safe_offline_results() -> None:
    unconfigured = GoogleMapsClient(None)
    with pytest.raises(ProviderNotConfiguredError):
        await unconfigured.search_places("Islamabad")

    origin = LocationRef(label="Home", formatted_address="Lahore")
    stop = LocationRef(label="Hotel", formatted_address="Islamabad")
    fallback = await unconfigured.compute_round_trip(
        origin=origin,
        stops=[stop],
        mode=TravelMode.DRIVE,
        kind="trip_overview",
    )
    await unconfigured.close()

    assert fallback.distance_meters is None
    assert fallback.encoded_polyline is None
    assert "not configured" in fallback.warnings[0]

    def failed_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"error": {"message": "denied"}})

    http_client = httpx.AsyncClient(transport=httpx.MockTransport(failed_handler))
    configured = GoogleMapsClient("dummy-key", client=http_client)
    try:
        with pytest.raises(ExternalProviderError, match="HTTP 403"):
            await configured.search_places("Islamabad")
        failed_route = await configured.compute_round_trip(
            origin=origin,
            stops=[stop],
            mode=TravelMode.DRIVE,
            kind="trip_overview",
        )
    finally:
        await http_client.aclose()

    assert failed_route.distance_meters is None
    assert "HTTP 403" in failed_route.warnings[0]
