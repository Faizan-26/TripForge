from typing import Any

from langgraph.types import StreamWriter

from app.agents.common import emit
from app.graph.state import TripState
from app.services.budget import calculate_budget


class BudgetEngine:
    name = "budget"

    async def __call__(self, state: TripState, writer: StreamWriter) -> dict[str, Any]:
        emit(writer, "agent.started", self.name, "Calculating known costs without guessing")
        stay_id = state["compatibility"].selected_stay_id
        stay = next(
            (
                item
                for item in state["stay_research"].candidates
                if item.provider_id == stay_id
            ),
            None,
        )
        summary = calculate_budget(state["requirements"], stay, state["itinerary"])
        emit(
            writer,
            "agent.completed",
            self.name,
            "Budget coverage has been calculated",
            {"coverage": summary.coverage, "known_cost_total": summary.known_cost_total},
        )
        return {"budget": summary}
