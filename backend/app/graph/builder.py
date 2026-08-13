from langgraph.graph import END, START, StateGraph

from app.agents.budget import BudgetEngine
from app.agents.compatibility import CompatibilityLayer
from app.agents.itinerary import ItineraryAgent
from app.agents.research import ActivityAgent, StayAgent, TravelInfoAgent
from app.agents.scope import TripScopeAgent
from app.agents.supervisor import SupervisorAgent
from app.agents.validator import ValidatorAgent
from app.core.config import Settings
from app.graph.state import TripState
from app.llm.base import PlanningModel
from app.tools.google_maps import GoogleMapsClient


def build_trip_graph(
    *,
    settings: Settings,
    model: PlanningModel,
    maps: GoogleMapsClient,
):
    builder = StateGraph(TripState)
    builder.add_node("supervisor", SupervisorAgent(model))
    builder.add_node("trip_scope", TripScopeAgent(model))
    builder.add_node(
        "stay",
        StayAgent(maps=maps, max_results=settings.max_research_results),
    )
    builder.add_node(
        "activity",
        ActivityAgent(
            maps=maps,
            max_results=settings.max_research_results,
            max_queries=settings.max_activity_queries,
        ),
    )
    builder.add_node("travel_info", TravelInfoAgent(maps=maps))
    builder.add_node("compatibility", CompatibilityLayer())
    builder.add_node("itinerary", ItineraryAgent(model=model, maps=maps))
    builder.add_node("budget", BudgetEngine())
    builder.add_node("validator", ValidatorAgent())

    builder.add_edge(START, "supervisor")
    builder.add_conditional_edges(
        "supervisor",
        _after_supervisor,
        {"clarify": END, "plan": "trip_scope"},
    )
    builder.add_edge("trip_scope", "stay")
    builder.add_edge("trip_scope", "activity")
    builder.add_edge("trip_scope", "travel_info")
    builder.add_edge(["stay", "activity", "travel_info"], "compatibility")
    builder.add_edge("compatibility", "itinerary")
    builder.add_edge("itinerary", "budget")
    builder.add_edge("budget", "validator")
    builder.add_edge("validator", END)
    return builder.compile()


def _after_supervisor(state: TripState) -> str:
    return "clarify" if state.get("clarifications") else "plan"
