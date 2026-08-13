from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlencode

import httpx

from app.schemas.common import LocationRef, SourceRef
from app.schemas.trip import (
    GoogleOpeningHoursPayload,
    GooglePhotoPayload,
    GooglePlacePayload,
    GoogleReviewPayload,
    MapRoute,
    RouteLeg,
    TravelMode,
)


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
                    "places.types,places.priceLevel,places.businessStatus,places.photos,"
                    "places.reviews,places.editorialSummary,places.regularOpeningHours,"
                    "places.nationalPhoneNumber,places.internationalPhoneNumber,"
                    "places.accessibilityOptions,places.parkingOptions,places.allowsDogs,"
                    "places.servesBreakfast,places.restroom"
                ),
            },
        )
        places: list[GooglePlacePayload] = []
        for item in response.get("places", []):
            display_name = item.get("displayName", {})
            location = item.get("location", {})
            opening_hours = item.get("regularOpeningHours")
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
                    business_status=item.get("businessStatus"),
                    national_phone_number=item.get("nationalPhoneNumber"),
                    international_phone_number=item.get("internationalPhoneNumber"),
                    editorial_summary=item.get("editorialSummary", {}).get("text"),
                    amenities=_place_amenities(item),
                    photos=[_photo_payload(photo) for photo in item.get("photos", [])[:10]],
                    reviews=[_review_payload(review) for review in item.get("reviews", [])[:5]],
                    opening_hours=(
                        GoogleOpeningHoursPayload(
                            open_now=opening_hours.get("openNow"),
                            weekday_descriptions=opening_hours.get(
                                "weekdayDescriptions", []
                            ),
                            next_open_time=opening_hours.get("nextOpenTime"),
                            next_close_time=opening_hours.get("nextCloseTime"),
                        )
                        if opening_hours
                        else None
                    ),
                )
            )
        return places

    async def get_photo_media(
        self,
        photo_name: str,
        *,
        max_width_px: int = 1200,
        max_height_px: int = 900,
    ) -> httpx.Response:
        self._require_key()
        if not photo_name.startswith("places/") or "/photos/" not in photo_name:
            raise ValueError("Invalid Google Places photo resource name")
        width = min(max(max_width_px, 1), 4800)
        height = min(max(max_height_px, 1), 4800)
        try:
            response = await self._client.get(
                f"https://places.googleapis.com/v1/{photo_name}/media",
                params={"maxWidthPx": width, "maxHeightPx": height},
                headers={"X-Goog-Api-Key": self._api_key or ""},
                follow_redirects=True,
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise ExternalProviderError(
                f"photo provider returned HTTP {exc.response.status_code}"
            ) from exc
        except httpx.HTTPError as exc:
            raise ExternalProviderError("photo provider request failed") from exc
        return response

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


def _photo_payload(value: dict[str, Any]) -> GooglePhotoPayload:
    author = (value.get("authorAttributions") or [{}])[0]
    return GooglePhotoPayload(
        name=value.get("name", ""),
        width_px=value.get("widthPx"),
        height_px=value.get("heightPx"),
        author_name=author.get("displayName"),
        author_uri=author.get("uri"),
        author_photo_uri=author.get("photoUri"),
        google_maps_uri=value.get("googleMapsUri"),
        flag_content_uri=value.get("flagContentUri"),
    )


def _review_payload(value: dict[str, Any]) -> GoogleReviewPayload:
    author = value.get("authorAttribution") or {}
    return GoogleReviewPayload(
        name=value.get("name", ""),
        rating=value.get("rating", 0),
        text=(value.get("text") or {}).get("text"),
        relative_publish_time_description=value.get(
            "relativePublishTimeDescription"
        ),
        publish_time=value.get("publishTime"),
        author_name=author.get("displayName"),
        author_uri=author.get("uri"),
        author_photo_uri=author.get("photoUri"),
        google_maps_uri=value.get("googleMapsUri"),
        flag_content_uri=value.get("flagContentUri"),
    )


def _place_amenities(value: dict[str, Any]) -> list[str]:
    labels: list[str] = []
    accessibility = value.get("accessibilityOptions") or {}
    parking = value.get("parkingOptions") or {}
    options = (
        ("allowsDogs", "Dogs allowed"),
        ("servesBreakfast", "Breakfast available"),
        ("restroom", "Restroom"),
    )
    accessibility_options = (
        ("wheelchairAccessibleEntrance", "Wheelchair-accessible entrance"),
        ("wheelchairAccessibleParking", "Wheelchair-accessible parking"),
        ("wheelchairAccessibleRestroom", "Wheelchair-accessible restroom"),
        ("wheelchairAccessibleSeating", "Wheelchair-accessible seating"),
    )
    parking_options = (
        ("freeParkingLot", "Free parking lot"),
        ("paidParkingLot", "Paid parking lot"),
        ("freeStreetParking", "Free street parking"),
        ("paidStreetParking", "Paid street parking"),
        ("valetParking", "Valet parking"),
    )
    labels.extend(label for key, label in options if value.get(key) is True)
    labels.extend(
        label for key, label in accessibility_options if accessibility.get(key) is True
    )
    labels.extend(label for key, label in parking_options if parking.get(key) is True)
    return labels
