import asyncio
from datetime import UTC, datetime
from typing import Any, Literal

from langgraph.types import StreamWriter

from app.agents.common import emit
from app.graph.state import TripState
from app.schemas.common import LocationRef, SourceRef
from app.schemas.trip import GooglePlacePayload, PlaceCandidate, ResearchResult
from app.tools.google_maps import (
    ExternalProviderError,
    GoogleMapsClient,
    ProviderNotConfiguredError,
)


class StayAgent:
    name = "stay"

    def __init__(self, maps: GoogleMapsClient, max_results: int) -> None:
        self._maps = maps
        self._max_results = max_results

    async def __call__(self, state: TripState, writer: StreamWriter) -> dict[str, Any]:
        scope = state["scope"]
        selected_hotel = state["requirements"].selected_hotel
        emit(writer, "agent.started", self.name, "Researching grounded stay options")
        if selected_hotel:
            provider_id = (
                selected_hotel.provider_ids.get("google_places")
                or selected_hotel.property_id
            )
            selected_candidate = PlaceCandidate(
                provider_id=provider_id,
                kind="stay",
                name=selected_hotel.name,
                location=LocationRef(
                    label=selected_hotel.location.label,
                    formatted_address=selected_hotel.location.formatted_address,
                    place_id=selected_hotel.location.place_id,
                    coordinates=selected_hotel.location.coordinates,
                    google_maps_uri=selected_hotel.location.google_maps_uri,
                ),
                types=["lodging"],
                website_uri=None,
                source=SourceRef(
                    provider=(
                        "google_places"
                        if selected_hotel.provider_ids.get("google_places")
                        else "user"
                    ),
                    provider_id=provider_id,
                    uri=selected_hotel.location.google_maps_uri,
                    retrieved_at=datetime.now(UTC).isoformat(),
                ),
            )
            emit(
                writer,
                "agent.completed",
                self.name,
                "Using the traveler-selected hotel",
                {"selected_stay_id": provider_id},
            )
            return {
                "stay_research": ResearchResult(
                    candidates=[selected_candidate],
                    warnings=[
                        "The traveler selected this property from an earlier hotel search."
                    ],
                )
            }
        emit(writer, "tool.started", self.name, "Searching Google Places for lodging")
        warnings = [
            "Google Places does not provide live room prices or availability; a dedicated "
            "accommodation availability provider is outside the current phase."
        ]
        try:
            results = await asyncio.gather(
                *(
                    self._maps.search_places(
                        f"hotels in {region}",
                        max_results=self._max_results,
                        included_type="lodging",
                    )
                    for region in scope.base_regions
                ),
                return_exceptions=True,
            )
            places: list[GooglePlacePayload] = []
            for result in results:
                if isinstance(result, Exception):
                    warnings.append(str(result))
                else:
                    places.extend(result)
        except (ProviderNotConfiguredError, ExternalProviderError) as exc:
            places = []
            warnings.append(str(exc))
        candidates = _to_candidates(places, "stay")
        emit(
            writer,
            "tool.completed",
            self.name,
            f"Found {len(candidates)} provider-grounded stays",
            {"count": len(candidates), "provider": "google_places"},
        )
        emit(writer, "agent.completed", self.name, "Stay research finished")
        return {"stay_research": ResearchResult(candidates=candidates, warnings=warnings)}


class ActivityAgent:
    name = "activity"

    def __init__(self, maps: GoogleMapsClient, max_results: int, max_queries: int) -> None:
        self._maps = maps
        self._max_results = max_results
        self._max_queries = max_queries

    async def __call__(self, state: TripState, writer: StreamWriter) -> dict[str, Any]:
        scope = state["scope"]
        trip = state["requirements"]
        emit(writer, "agent.started", self.name, "Researching activities and places")
        queries = [
            f"best {interest} attractions in {region}"
            for region in scope.base_regions
            for interest in trip.interests
        ]
        if not queries:
            queries = [
                f"best attractions in {region}" for region in scope.base_regions
            ]
        queries = queries[: self._max_queries]
        emit(
            writer,
            "tool.started",
            self.name,
            "Searching Google Places for relevant activities",
            {"query_count": len(queries)},
        )
        warnings: list[str] = []
        try:
            results = await asyncio.gather(
                *(
                    self._maps.search_places(query, max_results=self._max_results)
                    for query in queries
                ),
                return_exceptions=True,
            )
            places: list[GooglePlacePayload] = []
            for result in results:
                if isinstance(result, Exception):
                    warnings.append(str(result))
                else:
                    places.extend(result)
        except (ProviderNotConfiguredError, ExternalProviderError) as exc:
            places = []
            warnings.append(str(exc))
        candidates = _to_candidates(places, "activity")
        emit(
            writer,
            "tool.completed",
            self.name,
            f"Found {len(candidates)} provider-grounded activities",
            {"count": len(candidates), "provider": "google_places"},
        )
        emit(writer, "agent.completed", self.name, "Activity research finished")
        return {"activity_research": ResearchResult(candidates=candidates, warnings=warnings)}


class TravelInfoAgent:
    name = "travel_info"

    def __init__(self, maps: GoogleMapsClient) -> None:
        self._maps = maps

    async def __call__(self, state: TripState, writer: StreamWriter) -> dict[str, Any]:
        scope = state["scope"]
        emit(writer, "agent.started", self.name, "Grounding destination map anchors")
        warnings: list[str] = []
        try:
            places = await self._maps.search_places(scope.destination, max_results=3)
        except (ProviderNotConfiguredError, ExternalProviderError) as exc:
            places = []
            warnings.append(str(exc))
        candidates = _to_candidates(places, "travel_info")
        emit(
            writer,
            "agent.completed",
            self.name,
            "Travel map anchors are ready",
            {"count": len(candidates)},
        )
        return {"travel_info_research": ResearchResult(candidates=candidates, warnings=warnings)}


def _to_candidates(
    places: list[GooglePlacePayload],
    kind: Literal["stay", "activity", "travel_info"],
) -> list[PlaceCandidate]:
    candidates: list[PlaceCandidate] = []
    seen: set[str] = set()
    retrieved_at = datetime.now(UTC).isoformat()
    for place in places:
        if place.id in seen:
            continue
        seen.add(place.id)
        candidates.append(
            PlaceCandidate(
                provider_id=place.id,
                kind=kind,
                name=place.display_name,
                location=LocationRef(
                    label=place.display_name,
                    formatted_address=place.formatted_address,
                    place_id=place.id,
                    coordinates=place.coordinates(),
                    google_maps_uri=place.google_maps_uri,
                ),
                types=place.types,
                rating=place.rating,
                user_rating_count=place.user_rating_count,
                price_level=place.price_level,
                website_uri=place.website_uri,
                source=SourceRef(
                    provider="google_places",
                    provider_id=place.id,
                    uri=place.google_maps_uri,
                    retrieved_at=retrieved_at,
                ),
            )
        )
    return candidates
