import asyncio
from datetime import timedelta
from typing import Any

from langgraph.types import StreamWriter

from app.agents.common import emit
from app.graph.state import TripState
from app.llm.base import PlanningModel
from app.schemas.common import LocationRef
from app.schemas.trip import ItineraryDay, ItineraryStop, MapRoute, PlaceCandidate
from app.tools.google_maps import GoogleMapsClient


class ItineraryAgent:
    name = "itinerary"

    def __init__(self, model: PlanningModel, maps: GoogleMapsClient) -> None:
        self._model = model
        self._maps = maps

    async def __call__(self, state: TripState, writer: StreamWriter) -> dict[str, Any]:
        trip = state["requirements"]
        compatibility = state["compatibility"]
        stays = {item.provider_id: item for item in state["stay_research"].candidates}
        activities = {
            item.provider_id: item for item in state["activity_research"].candidates
        }
        stay = stays.get(compatibility.selected_stay_id or "")
        allowed = [
            activities[provider_id]
            for provider_id in compatibility.compatible_activity_ids
            if provider_id in activities
        ]

        emit(writer, "agent.started", self.name, "Building a realistic day-by-day itinerary")
        decision = await self._model.arrange_itinerary(trip, stay, allowed)
        itinerary = _materialize_days(
            decision.days,
            trip.start_date,
            trip.duration_days,
            activities,
        )

        daily_routes: list[MapRoute | None] = [None] * len(itinerary)
        overview: MapRoute | None = None
        if stay:
            emit(writer, "tool.started", self.name, "Optimizing daily round-trip routes")
            routes = await asyncio.gather(
                *(
                    self._maps.compute_round_trip(
                        origin=stay.location,
                        stops=[stop.place.location for stop in day.stops],
                        mode=trip.travel_mode,
                        kind="daily_round_trip",
                        day=day.day,
                    )
                    for day in itinerary
                    if day.stops
                )
            )
            route_by_day = {route.day: route for route in routes}
            daily_routes = [route_by_day.get(day.day) for day in itinerary]
            home = _origin_ref(trip.origin)
            overview = await self._maps.compute_round_trip(
                origin=home,
                stops=[stay.location],
                mode=trip.travel_mode,
                kind="trip_overview",
            )
            emit(writer, "tool.completed", self.name, "Map routes are ready")

        itinerary = [
            day.model_copy(update={"route": daily_routes[index]})
            for index, day in enumerate(itinerary)
        ]
        emit(
            writer,
            "agent.completed",
            self.name,
            "Day-by-day itinerary is assembled",
            {"day_count": len(itinerary)},
        )
        return {"itinerary": itinerary, "trip_overview_route": overview}


def _materialize_days(
    assignments: list[Any],
    start_date: Any,
    duration_days: int,
    activities: dict[str, PlaceCandidate],
) -> list[ItineraryDay]:
    by_day = {assignment.day: assignment for assignment in assignments}
    used: set[str] = set()
    days: list[ItineraryDay] = []
    for day_number in range(1, duration_days + 1):
        assignment = by_day.get(day_number)
        stops: list[ItineraryStop] = []
        if assignment:
            for provider_id in assignment.activity_ids:
                if provider_id in used or provider_id not in activities:
                    continue
                used.add(provider_id)
                stops.append(
                    ItineraryStop(sequence=len(stops) + 1, place=activities[provider_id])
                )
        days.append(
            ItineraryDay(
                day=day_number,
                date=start_date + timedelta(days=day_number - 1) if start_date else None,
                title=assignment.title if assignment else f"Day {day_number}",
                stops=stops,
            )
        )
    return days


def _origin_ref(origin: Any) -> LocationRef:
    return LocationRef(
        label=origin.label or origin.address or "Trip origin",
        formatted_address=origin.address,
        place_id=origin.place_id,
        coordinates=origin.coordinates,
    )
