from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlencode

import httpx

from app.schemas.common import LocationRef, SourceRef
from app.schemas.trip import GooglePlacePayload, MapRoute, RouteLeg, TravelMode


class ProviderNotConfiguredError(RuntimeError):
    pass


class ExternalProviderError(RuntimeError):
    pass


class GoogleMapsClient:
    _PLACES_URL = "https://places.googleapis.com/v1/places:searchText"
    _ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes"

    def __init__(self, api_key: str | None, client: httpx.AsyncClient | None = None) -> None:
        self._api_key = api_key
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=5.0))

    @property
    def configured(self) -> bool:
        return bool(self._api_key)

    async def close(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def search_places(
        self,
        text_query: str,
        *,
        max_results: int = 8,
        included_type: str | None = None,
    ) -> list[GooglePlacePayload]:
        self._require_key()
        body: dict[str, Any] = {
            "textQuery": text_query,
            "pageSize": max_results,
            "languageCode": "en",
        }
        if included_type:
            body["includedType"] = included_type
        response = await self._post(
            self._PLACES_URL,
            json=body,
            headers={
                "X-Goog-Api-Key": self._api_key or "",
                "X-Goog-FieldMask": (
                    "places.id,places.displayName,places.formattedAddress,places.location,"
                    "places.rating,places.userRatingCount,places.googleMapsUri,places.websiteUri,"
                    "places.types,places.priceLevel"
                ),
            },
        )
        places: list[GooglePlacePayload] = []
        for item in response.get("places", []):
            display_name = item.get("displayName", {})
            location = item.get("location", {})
            places.append(
                GooglePlacePayload(
                    id=item["id"],
                    display_name=display_name.get("text", ""),
                    formatted_address=item.get("formattedAddress"),
                    latitude=location.get("latitude"),
                    longitude=location.get("longitude"),
                    rating=item.get("rating"),
                    user_rating_count=item.get("userRatingCount"),
                    google_maps_uri=item.get("googleMapsUri"),
                    website_uri=item.get("websiteUri"),
                    types=item.get("types", []),
                    price_level=item.get("priceLevel"),
                )
            )
        return places

    async def compute_round_trip(
        self,
        *,
        origin: LocationRef,
        stops: list[LocationRef],
        mode: TravelMode,
        kind: str,
        day: int | None = None,
    ) -> MapRoute:
        maps_url = build_google_maps_directions_url(origin, origin, stops, mode)
        if not stops:
            return MapRoute(
                kind=kind,
                day=day,
                origin=origin,
                destination=origin,
                google_maps_url=maps_url,
                warnings=["No route stops were available."],
            )
        if not self.configured:
            return MapRoute(
                kind=kind,
                day=day,
                origin=origin,
                destination=origin,
                ordered_stops=stops,
                google_maps_url=maps_url,
                warnings=[
                    "Google Routes is not configured; distance and polyline are unavailable."
                ],
            )
        if mode == TravelMode.TRANSIT and len(stops) > 1:
            return MapRoute(
                kind=kind,
                day=day,
                origin=origin,
                destination=origin,
                ordered_stops=stops,
                google_maps_url=maps_url,
                warnings=[
                    "Multi-stop transit optimization is not supported by this route adapter."
                ],
            )

        intermediates = stops[:25]
        optimize = mode == TravelMode.DRIVE and len(intermediates) > 1
        body: dict[str, Any] = {
            "origin": _waypoint(origin),
            "destination": _waypoint(origin),
            "intermediates": [_waypoint(stop) for stop in intermediates],
            "travelMode": mode.value,
            "computeAlternativeRoutes": False,
            "languageCode": "en-US",
            "units": "METRIC",
            "optimizeWaypointOrder": optimize,
        }
        try:
            payload = await self._post(
                self._ROUTES_URL,
                json=body,
                headers={
                    "X-Goog-Api-Key": self._api_key or "",
                    "X-Goog-FieldMask": (
                        "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,"
                        "routes.optimizedIntermediateWaypointIndex,routes.legs.distanceMeters,"
                        "routes.legs.duration"
                    ),
                },
            )
        except ExternalProviderError as exc:
            return MapRoute(
                kind=kind,
                day=day,
                origin=origin,
                destination=origin,
                ordered_stops=intermediates,
                google_maps_url=maps_url,
                warnings=[f"Google Routes could not compute this round trip: {exc}"],
            )

        routes = payload.get("routes", [])
        if not routes:
            return MapRoute(
                kind=kind,
                day=day,
                origin=origin,
                destination=origin,
                ordered_stops=intermediates,
                google_maps_url=maps_url,
                warnings=["Google Routes returned no drivable route."],
            )
        route = routes[0]
        order = route.get("optimizedIntermediateWaypointIndex", list(range(len(intermediates))))
        ordered_stops = [intermediates[index] for index in order]
        points = [origin, *ordered_stops, origin]
        legs = [
            RouteLeg(
                from_label=points[index].label,
                to_label=points[index + 1].label,
                distance_meters=leg.get("distanceMeters"),
                duration_seconds=_duration_seconds(leg.get("duration")),
            )
            for index, leg in enumerate(route.get("legs", []))
            if index + 1 < len(points)
        ]
        return MapRoute(
            kind=kind,
            day=day,
            origin=origin,
            destination=origin,
            ordered_stops=ordered_stops,
            legs=legs,
            distance_meters=route.get("distanceMeters"),
            duration_seconds=_duration_seconds(route.get("duration")),
            encoded_polyline=route.get("polyline", {}).get("encodedPolyline"),
            google_maps_url=build_google_maps_directions_url(origin, origin, ordered_stops, mode),
            source=SourceRef(
                provider="google_routes",
                uri=self._ROUTES_URL,
                retrieved_at=datetime.now(UTC).isoformat(),
            ),
            warnings=(
                ["Only the first 25 stops were routed."] if len(stops) > len(intermediates) else []
            ),
        )

    def _require_key(self) -> None:
        if not self._api_key:
            raise ProviderNotConfiguredError("GOOGLE_MAPS_API_KEY is not configured")

    async def _post(self, url: str, **kwargs: Any) -> dict[str, Any]:
        try:
            response = await self._client.post(url, **kwargs)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            raise ExternalProviderError(f"provider returned HTTP {status}") from exc
        except httpx.HTTPError as exc:
            raise ExternalProviderError("provider request failed") from exc
        return response.json()


def build_google_maps_directions_url(
    origin: LocationRef,
    destination: LocationRef,
    stops: list[LocationRef],
    mode: TravelMode,
) -> str:
    travel_modes = {
        TravelMode.DRIVE: "driving",
        TravelMode.WALK: "walking",
        TravelMode.BICYCLE: "bicycling",
        TravelMode.TRANSIT: "transit",
    }
    params = {
        "api": "1",
        "origin": _location_query(origin),
        "destination": _location_query(destination),
        "travelmode": travel_modes[mode],
    }
    if stops:
        params["waypoints"] = "|".join(_location_query(stop) for stop in stops[:25])
    return f"https://www.google.com/maps/dir/?{urlencode(params)}"


def _waypoint(location: LocationRef) -> dict[str, Any]:
    if location.place_id:
        return {"placeId": location.place_id}
    if location.coordinates:
        return {
            "location": {
                "latLng": {
                    "latitude": location.coordinates.latitude,
                    "longitude": location.coordinates.longitude,
                }
            }
        }
    return {"address": location.formatted_address or location.label}


def _location_query(location: LocationRef) -> str:
    if location.coordinates:
        return f"{location.coordinates.latitude},{location.coordinates.longitude}"
    return location.formatted_address or location.label


def _duration_seconds(value: str | None) -> int | None:
    if not value or not value.endswith("s"):
        return None
    try:
        return round(float(value[:-1]))
    except ValueError:
        return None
