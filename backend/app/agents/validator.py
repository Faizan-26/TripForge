from collections import Counter
from typing import Any

from langgraph.types import StreamWriter

from app.agents.common import emit
from app.graph.state import TripState
from app.schemas.trip import TripPlan, ValidationIssue


class ValidatorAgent:
    name = "validator"

    async def __call__(self, state: TripState, writer: StreamWriter) -> dict[str, Any]:
        emit(writer, "agent.started", self.name, "Validating grounding and hard constraints")
        issues: list[ValidationIssue] = []
        stay_id = state["compatibility"].selected_stay_id
        stay = next(
            (
                item
                for item in state["stay_research"].candidates
                if item.provider_id == stay_id
            ),
            None,
        )
        if not stay:
            issues.append(
                ValidationIssue(
                    code="stay.missing",
                    message="No grounded stay could be selected.",
                    severity="error",
                    retry_nodes=["stay"],
                )
            )
        all_stops = [stop for day in state["itinerary"] for stop in day.stops]
        if not all_stops:
            issues.append(
                ValidationIssue(
                    code="activities.missing",
                    message="No grounded activities could be scheduled.",
                    severity="error",
                    retry_nodes=["activity"],
                )
            )
        duplicate_ids = [
            provider_id
            for provider_id, count in Counter(
                stop.place.provider_id for stop in all_stops
            ).items()
            if count > 1
        ]
        if duplicate_ids:
            issues.append(
                ValidationIssue(
                    code="itinerary.duplicates",
                    message="One or more activities appear on multiple days.",
                    severity="error",
                    retry_nodes=["itinerary"],
                    details={"provider_ids": duplicate_ids},
                )
            )
        ungrounded = [stop.place.name for stop in all_stops if not stop.place.source.provider_id]
        if ungrounded:
            issues.append(
                ValidationIssue(
                    code="entity.ungrounded",
                    message="Every itinerary entity must retain a provider ID.",
                    severity="error",
                    retry_nodes=["itinerary"],
                    details={"entities": ungrounded},
                )
            )
        if state["budget"].coverage != "complete":
            issues.append(
                ValidationIssue(
                    code="budget.partial",
                    message="Live pricing is incomplete, so the budget cannot be fully validated.",
                    severity="warning",
                    retry_nodes=["stay", "activity"],
                    details={
                        "unknown_categories": state["budget"].unknown_cost_categories,
                    },
                )
            )
        if state["budget"].is_within_budget is False:
            issues.append(
                ValidationIssue(
                    code="budget.exceeded",
                    message="Known trip costs exceed the traveler's budget.",
                    severity="error",
                    retry_nodes=["stay", "activity", "itinerary"],
                )
            )

        research_warnings = list(
            dict.fromkeys(
                [
                    *state["stay_research"].warnings,
                    *state["activity_research"].warnings,
                    *state["travel_info_research"].warnings,
                    *state["compatibility"].warnings,
                ]
            )
        )
        status = "invalid" if any(issue.severity == "error" for issue in issues) else "valid"
        plan = TripPlan(
            status=status,
            requirements=state["requirements"],
            scope=state["scope"],
            selected_stay=stay,
            itinerary=state["itinerary"],
            trip_overview_route=state.get("trip_overview_route"),
            budget=state["budget"],
            validation=issues,
            research_warnings=research_warnings,
        )
        emit(
            writer,
            "validation.completed",
            self.name,
            "Trip validation finished",
            {
                "status": status,
                "error_count": sum(issue.severity == "error" for issue in issues),
                "warning_count": sum(issue.severity == "warning" for issue in issues),
            },
        )
        emit(
            writer,
            "agent.completed",
            self.name,
            "The planning pipeline is complete",
        )
        return {"validation": issues, "plan": plan}
