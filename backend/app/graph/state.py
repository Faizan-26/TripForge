from typing import TypedDict

from app.schemas.trip import (
    BudgetSummary,
    ClarificationQuestion,
    CompatibilityResult,
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


class TripState(TypedDict, total=False):
    request: PlanTripRequest
    draft: TripRequestDraft
    requirements: TripRequirements
    clarifications: list[ClarificationQuestion]
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
