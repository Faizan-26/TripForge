from dataclasses import dataclass
from enum import StrEnum


class ToolRisk(StrEnum):
    READ = "read"


@dataclass(frozen=True)
class ToolDefinition:
    name: str
    owner: str
    risk: ToolRisk
    requires_approval: bool


TOOL_REGISTRY = {
    "google_places.search": ToolDefinition(
        name="google_places.search",
        owner="research_agents",
        risk=ToolRisk.READ,
        requires_approval=False,
    ),
    "google_routes.compute": ToolDefinition(
        name="google_routes.compute",
        owner="itinerary_agent",
        risk=ToolRisk.READ,
        requires_approval=False,
    ),
}
