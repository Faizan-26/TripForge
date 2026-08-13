from typing import Protocol

from app.schemas.trip import (
    ConversationTurn,
    GeneralAssistantResult,
    ItineraryDecision,
    PlaceCandidate,
    ScopeDecision,
    TripRequestDraft,
    TripRequirements,
)


class PlanningModel(Protocol):
    name: str

    async def extract_trip(self, message: str) -> TripRequestDraft: ...

    async def answer_general(
        self, message: str, context: list[ConversationTurn]
    ) -> GeneralAssistantResult: ...

    async def suggest_title(self, message: str) -> str: ...

    async def decide_scope(self, trip: TripRequirements) -> ScopeDecision: ...

    async def arrange_itinerary(
        self,
        trip: TripRequirements,
        stay: PlaceCandidate | None,
        activities: list[PlaceCandidate],
    ) -> ItineraryDecision: ...
