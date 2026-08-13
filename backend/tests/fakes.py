import asyncio
from datetime import UTC, datetime

from app.schemas.common import LocationRef, SourceRef
from app.schemas.trip import GooglePlacePayload, MapRoute, RouteLeg, TravelMode
from app.tools.google_maps import build_google_maps_directions_url


class FakeGoogleMapsClient:
    configured = True

    def __init__(self) -> None:
        self.active_searches = 0
        self.max_active_searches = 0
        self.closed = False

    async def close(self) -> None:
        self.closed = True

    async def search_places(
        self,
        text_query: str,
        *,
        max_results: int = 8,
        included_type: str | None = None,
    ) -> list[GooglePlacePayload]:
        self.active_searches += 1
        self.max_active_searches = max(self.max_active_searches, self.active_searches)
        await asyncio.sleep(0.01)
        self.active_searches -= 1
        lower = text_query.lower()
        if "hotels" in lower:
            return [
                GooglePlacePayload(
                    id="stay-1",
                    display_name="Provider Test Hotel",
                    formatted_address="Blue Area, Islamabad",
                    latitude=33.7100,
                    longitude=73.0551,
                    rating=4.5,
                    user_rating_count=850,
                    google_maps_uri="https://maps.google.com/?cid=stay-1",
                    types=["lodging"],
                )
            ]
        if "food" in lower:
            return [
                GooglePlacePayload(
                    id="activity-food",
                    display_name="Provider Food Market",
                    formatted_address="F-6, Islamabad",
                    latitude=33.7294,
                    longitude=73.0755,
                    rating=4.4,
                    user_rating_count=500,
                    google_maps_uri="https://maps.google.com/?cid=activity-food",
                    types=["market"],
                )
            ]
        if "culture" in lower:
            return [
                GooglePlacePayload(
                    id="activity-culture",
                    display_name="Provider Culture Museum",
                    formatted_address="Shakarparian, Islamabad",
                    latitude=33.6938,
                    longitude=73.0687,
                    rating=4.6,
                    user_rating_count=900,
                    google_maps_uri="https://maps.google.com/?cid=activity-culture",
                    types=["museum"],
                )
            ]
        return [
            GooglePlacePayload(
                id="destination-1",
                display_name="Islamabad",
                formatted_address="Islamabad, Pakistan",
                latitude=33.6844,
                longitude=73.0479,
                google_maps_uri="https://maps.google.com/?cid=destination-1",
                types=["locality"],
            )
        ][:max_results]

    async def compute_round_trip(
        self,
        *,
        origin: LocationRef,
        stops: list[LocationRef],
        mode: TravelMode,
        kind: str,
        day: int | None = None,
    ) -> MapRoute:
        points = [origin, *stops, origin]
        return MapRoute(
            kind=kind,
            day=day,
            origin=origin,
            destination=origin,
            ordered_stops=stops,
            legs=[
                RouteLeg(
                    from_label=points[index].label,
                    to_label=points[index + 1].label,
                    distance_meters=1000,
                    duration_seconds=300,
                )
                for index in range(len(points) - 1)
            ],
            distance_meters=1000 * max(len(points) - 1, 1),
            duration_seconds=300 * max(len(points) - 1, 1),
            encoded_polyline="test-polyline",
            google_maps_url=build_google_maps_directions_url(origin, origin, stops, mode),
            source=SourceRef(
                provider="google_routes",
                provider_id="fake-route",
                retrieved_at=datetime.now(UTC).isoformat(),
            ),
        )
