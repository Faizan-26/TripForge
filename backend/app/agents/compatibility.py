from typing import Any

from langgraph.types import StreamWriter

from app.agents.common import emit
from app.graph.state import TripState
from app.schemas.trip import CompatibilityResult, PlaceCandidate
from app.services.geo import haversine_km


class CompatibilityLayer:
    name = "compatibility"

    async def __call__(self, state: TripState, writer: StreamWriter) -> dict[str, Any]:
        emit(writer, "agent.started", self.name, "Checking stay and activity compatibility")
        stays = state["stay_research"].candidates
        activities = state["activity_research"].candidates
        stay = max(stays, key=_candidate_score) if stays else None
        compatible: list[PlaceCandidate] = []
        excluded: list[str] = []
        distances: dict[str, float] = {}
        warnings: list[str] = []
        max_distance_km = max(25.0, state["scope"].max_day_trip_minutes * 0.6)

        for activity in activities:
            if not stay or not stay.location.coordinates or not activity.location.coordinates:
                compatible.append(activity)
                if stay:
                    warnings.append(
                        f"Coordinates were unavailable for compatibility check: {activity.name}"
                    )
                continue
            distance = round(
                haversine_km(stay.location.coordinates, activity.location.coordinates), 2
            )
            distances[activity.provider_id] = distance
            if distance <= max_distance_km:
                compatible.append(activity)
            else:
                excluded.append(activity.provider_id)

        compatible.sort(
            key=lambda item: (
                distances.get(item.provider_id, 0),
                -_candidate_score(item),
            )
        )
        if distances:
            warnings.append(
                "Compatibility uses straight-line distance as a prefilter; daily routes use "
                "Google Routes for road distance and ordering."
            )
        result = CompatibilityResult(
            selected_stay_id=stay.provider_id if stay else None,
            compatible_activity_ids=[item.provider_id for item in compatible],
            excluded_activity_ids=excluded,
            distances_km=distances,
            warnings=list(dict.fromkeys(warnings)),
        )
        emit(
            writer,
            "agent.completed",
            self.name,
            "Compatible options are ranked",
            {
                "selected_stay_id": result.selected_stay_id,
                "activity_count": len(result.compatible_activity_ids),
                "excluded_count": len(result.excluded_activity_ids),
            },
        )
        return {"compatibility": result}


def _candidate_score(candidate: PlaceCandidate) -> float:
    rating = candidate.rating or 0
    confidence = min(candidate.user_rating_count or 0, 5000) / 5000
    return rating + confidence
