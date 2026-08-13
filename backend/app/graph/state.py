from typing import TypedDict

from app.schemas.trip import (
    BudgetSummary,
    ClarificationQuestion,
    CompatibilityResult,
    GeneralAssistantResult,
    ItineraryDay,
    MapRoute,
    PlanTripRequest,
    ResearchResult,
    TripPlan,
    TripRequestDraft,
    TripRequirements,
    TripScope,
    ValidationIssue,
)
from app.schemas.hotel import HotelSearchConstraints, HotelSearchResult


class TripState(TypedDict, total=False):
    request: PlanTripRequest
    draft: TripRequestDraft
    requirements: TripRequirements
    clarifications: list[ClarificationQuestion]
    conversation_title: str
    general_result: GeneralAssistantResult
    hotel_search: HotelSearchConstraints
    hotel_result: HotelSearchResult
    scope: TripScope
    stay_research: ResearchResult
    activity_research: ResearchResult
    travel_info_research: ResearchResult
    compatibility: CompatibilityResult
    itinerary: list[ItineraryDay]
    trip_overview_route: MapRoute | None
    budget: BudgetSummary
    validation: list[ValidationIssue]
    plan: TripPlan
