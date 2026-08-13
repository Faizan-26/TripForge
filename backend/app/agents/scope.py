from typing import Any

from langgraph.types import StreamWriter

from app.agents.common import emit
from app.graph.state import TripState
from app.llm.base import PlanningModel
from app.schemas.trip import TripScope


class TripScopeAgent:
    name = "trip_scope"

    def __init__(self, model: PlanningModel) -> None:
        self._model = model

    async def __call__(self, state: TripState, writer: StreamWriter) -> dict[str, Any]:
        trip = state["requirements"]
        emit(writer, "agent.started", self.name, "Establishing a shared geographic scope")
        decision = await self._model.decide_scope(trip)
        scope = TripScope(
            destination=trip.destination,
            trip_type=decision.trip_type,
            base_regions=decision.base_regions,
            max_day_trip_minutes=decision.max_day_trip_minutes,
            home_origin=trip.origin,
            rationale=decision.rationale,
        )
        emit(
            writer,
            "agent.completed",
            self.name,
            "Trip scope is ready for parallel research",
            {"scope": scope.model_dump(mode="json")},
        )
        return {"scope": scope}
