from __future__ import annotations

from datetime import date as Date
from enum import StrEnum
from typing import Any, Literal
from urllib.parse import urlencode
from uuid import UUID

from pydantic import Field, field_validator, model_validator

from app.schemas.common import (
    APIModel,
    Coordinates,
    CurrencyCode,
    LocationInput,
    LocationRef,
    SourceRef,
)
from app.schemas.hotel import HotelSearchConstraints, HotelSearchMode, SelectedHotelContext


class Intent(StrEnum):
    GENERAL = "GENERAL"
    FULL_TRIP_PLAN = "FULL_TRIP_PLAN"
    HOTEL_SEARCH = "HOTEL_SEARCH"


class TravelMode(StrEnum):
    DRIVE = "DRIVE"
    WALK = "WALK"
    BICYCLE = "BICYCLE"
    TRANSIT = "TRANSIT"


class DateRangeAnswer(APIModel):
    start_date: Date
    end_date: Date

    @model_validator(mode="after")
    def validate_order(self) -> DateRangeAnswer:
        if self.end_date < self.start_date:
            raise ValueError("end_date cannot be before start_date")
        return self


AnswerValue = str | int | float | bool | list[str] | DateRangeAnswer


class ConversationTurn(APIModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=6000)


WorkflowMode = Literal[
    "UNKNOWN",
    "GENERAL_TRAVEL",
    "PLACES_SEARCH",
    "FULL_TRIP_PLAN",
    "OUT_OF_SCOPE",
]
WorkflowGoal = Literal[
    "request_understanding",
    "trip_requirements",
    "hotel_selection",
    "historical_places",
    "itinerary",
    "complete",
]
WorkflowGoalStatus = Literal["pending", "in_progress", "completed", "skipped", "blocked"]
WorkflowNextAction = Literal[
    "classify_and_extract",
    "ask_only_missing_requirements",
    "ground_and_present_hotel_choices",
    "ground_historical_places",
    "compose_grounded_itinerary",
    "respond_to_follow_up",
]


class TripWorkflowRequirements(APIModel):
    lodging_required: bool | None = None
    historical_places_required: bool | None = None
    complete_after_current_answers: bool | None = None


class TripWorkflowEvidence(APIModel):
    hotel_candidates_grounded: bool = False
    historical_places_grounded: bool = False


class TripWorkflowState(APIModel):
    version: Literal["1"] = "1"
    mode: WorkflowMode = "UNKNOWN"
    locale: str | None = Field(default=None, max_length=40)
    turn: int = Field(default=0, ge=0, le=10_000)
    current_goal: WorkflowGoal = "request_understanding"
    goals: dict[WorkflowGoal, WorkflowGoalStatus]
    requirements: TripWorkflowRequirements
    evidence: TripWorkflowEvidence
    answered_question_ids: list[str] = Field(default_factory=list, max_length=100)
    last_question_ids: list[str] = Field(default_factory=list, max_length=12)
    next_action: WorkflowNextAction = "classify_and_extract"


class TravelPresentationFact(APIModel):
    label: str = Field(min_length=1, max_length=60)
    value: str = Field(min_length=1, max_length=180)


class TravelPresentationItem(APIModel):
    title: str = Field(min_length=1, max_length=180)
    time: str | None = Field(default=None, max_length=60)
    description: str | None = Field(default=None, max_length=500)
    location: str | None = Field(default=None, max_length=240)
    maps_url: str | None = Field(default=None, max_length=2000)


class TravelPresentationSection(APIModel):
    title: str = Field(min_length=1, max_length=160)
    subtitle: str | None = Field(default=None, max_length=240)
    items: list[TravelPresentationItem] = Field(min_length=1, max_length=8)


class TravelPresentation(APIModel):
    kind: Literal["trip_plan", "travel_answer", "hotel_advice"]
    title: str = Field(min_length=1, max_length=160)
    summary: str | None = Field(default=None, max_length=500)
    facts: list[TravelPresentationFact] = Field(default_factory=list, max_length=8)
    sections: list[TravelPresentationSection] = Field(default_factory=list, max_length=12)
    notes: list[str] = Field(default_factory=list, max_length=6)

    @model_validator(mode="after")
    def has_renderable_content(self) -> TravelPresentation:
        if not self.facts and not self.sections:
            raise ValueError("presentation requires facts or sections")
        return self


class GeneralAssistantResult(APIModel):
    intent: Literal["GENERAL"] = "GENERAL"
    message: str = Field(min_length=1, max_length=6000)
    conversation_title: str = Field(min_length=1, max_length=80)
    presentation: TravelPresentation | None = None


class PlanTripRequest(APIModel):
    message: str = Field(min_length=1, max_length=6000)
    conversation_id: UUID | None = None
    client_request_id: UUID | None = None
    client_message_id: UUID | None = None
    title: str | None = Field(default=None, min_length=1, max_length=200)
    answers: dict[str, AnswerValue] = Field(default_factory=dict)
    draft: dict[str, Any] = Field(default_factory=dict)
    workflow: TripWorkflowState | None = None
    origin: LocationInput | None = None
    parent_run_id: UUID | None = None
    intent: Intent | None = None
    hotel_search: HotelSearchConstraints | None = None
    selected_hotel: SelectedHotelContext | None = None
    context: list[ConversationTurn] = Field(default_factory=list, max_length=12)

    @field_validator("message")
    @classmethod
    def message_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("message cannot be blank")
        return value


class DynamicTripDraft(APIModel):
    intent: Intent | None = None
    hotel_search_mode: HotelSearchMode | None = None
    destination: str | None = None
    origin: str | None = None
    travelers: int | None = Field(default=None, ge=1, le=50)
    duration_days: int | None = Field(default=None, ge=1, le=60)
    start_date: Date | None = None
    end_date: Date | None = None
    budget_total: float | None = Field(default=None, ge=0)
    budget_band: Literal["economy", "balanced", "premium", "flexible"] | None = None
    currency: CurrencyCode = "USD"
    interests: list[str] = Field(default_factory=list, max_length=12)
    preferences: list[str] = Field(default_factory=list, max_length=20)
    pace: Literal["relaxed", "balanced", "active"] | None = None
    travel_mode: TravelMode = TravelMode.DRIVE
    dates_flexible: bool = True
    hotel_search: HotelSearchConstraints | None = None
    selected_hotel: SelectedHotelContext | None = None

    @model_validator(mode="after")
    def derive_duration(self) -> DynamicTripDraft:
        if self.start_date and self.end_date:
            if self.end_date < self.start_date:
                raise ValueError("end_date cannot be before start_date")
            if self.duration_days is None:
                self.duration_days = (self.end_date - self.start_date).days + 1
        return self


class TripRequestDraft(DynamicTripDraft):
    """Backward-compatible name for the conversational trip draft."""

    pass


class TripRequirements(APIModel):
    destination: str
    origin: LocationInput
    travelers: int = Field(ge=1, le=50)
    duration_days: int = Field(ge=1, le=60)
    start_date: Date | None = None
    end_date: Date | None = None
    dates_flexible: bool = True
    budget_total: float | None = Field(default=None, ge=0)
    budget_band: Literal["economy", "balanced", "premium", "flexible"] = "flexible"
    currency: CurrencyCode = "USD"
    interests: list[str] = Field(default_factory=list, max_length=12)
    preferences: list[str] = Field(default_factory=list, max_length=20)
    pace: Literal["relaxed", "balanced", "active"] = "balanced"
    travel_mode: TravelMode = TravelMode.DRIVE
    selected_hotel: SelectedHotelContext | None = None


class ClarificationOption(APIModel):
    value: str = Field(min_length=1, max_length=200)
    label: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=300)
    place_id: str | None = Field(default=None, max_length=300)
    address: str | None = Field(default=None, max_length=500)
    rating: float | None = Field(default=None, ge=0, le=5)
    review_count: int | None = Field(default=None, ge=0)
    maps_url: str | None = Field(default=None, max_length=2000)
    price_level: str | None = Field(default=None, max_length=80)
    photo_name: str | None = Field(default=None, max_length=1000, exclude=True)
    image_url: str | None = Field(default=None, max_length=2000)
    image_alt: str | None = Field(default=None, max_length=200)
    image_attribution: str | None = Field(default=None, max_length=160)
    image_attribution_url: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def attach_client_media_url(self) -> ClarificationOption:
        if self.photo_name:
            if not self.photo_name.startswith("places/") or "/photos/" not in self.photo_name:
                raise ValueError("photo_name must be a Google Places photo resource")
            self.image_url = f"/api/place-photos?{urlencode({'name': self.photo_name})}"
        return self


class ClarificationQuestion(APIModel):
    id: str = Field(min_length=1, max_length=80, pattern=r"^[a-z][a-z0-9_]*$")
    prompt: str = Field(min_length=1, max_length=300)
    kind: Literal[
        "single_select",
        "multi_select",
        "text",
        "textarea",
        "location",
        "number",
        "date",
        "date_range",
        "boolean",
    ]
    required: bool = True
    options: list[ClarificationOption] = Field(default_factory=list, max_length=12)
    description: str | None = Field(default=None, max_length=500)
    placeholder: str | None = Field(default=None, max_length=160)
    allow_other: bool = True
    min_value: float | None = None
    max_value: float | None = None
    step: float | None = Field(default=None, gt=0)
    min_length: int | None = Field(default=None, ge=0, le=6000)
    max_length: int | None = Field(default=None, ge=1, le=6000)

    @model_validator(mode="after")
    def validate_question_shape(self) -> ClarificationQuestion:
        if self.kind in {"single_select", "multi_select"} and not self.options:
            raise ValueError("select questions require at least one option")
        if self.min_value is not None and self.max_value is not None:
            if self.min_value > self.max_value:
                raise ValueError("min_value cannot exceed max_value")
        if self.min_length is not None and self.max_length is not None:
            if self.min_length > self.max_length:
                raise ValueError("min_length cannot exceed max_length")
        return self


class ScopeDecision(APIModel):
    trip_type: Literal["single_base", "multi_base"] = "single_base"
    base_regions: list[str] = Field(min_length=1, max_length=5)
    max_day_trip_minutes: int = Field(default=180, ge=30, le=600)
    rationale: str = Field(max_length=1000)


class TripScope(APIModel):
    destination: str
    trip_type: Literal["single_base", "multi_base"]
    base_regions: list[str]
    max_day_trip_minutes: int
    home_origin: LocationInput
    rationale: str


class PlaceCandidate(APIModel):
    provider_id: str
    kind: Literal["stay", "activity", "travel_info"]
    name: str
    location: LocationRef
    types: list[str] = Field(default_factory=list)
    rating: float | None = Field(default=None, ge=0, le=5)
    user_rating_count: int | None = Field(default=None, ge=0)
    price_level: str | None = None
    website_uri: str | None = None
    estimated_cost: float | None = Field(default=None, ge=0)
    cost_currency: CurrencyCode | None = None
    source: SourceRef


class ResearchResult(APIModel):
    candidates: list[PlaceCandidate] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class CompatibilityResult(APIModel):
    selected_stay_id: str | None = None
    compatible_activity_ids: list[str] = Field(default_factory=list)
    excluded_activity_ids: list[str] = Field(default_factory=list)
    distances_km: dict[str, float] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)


class ItineraryAssignment(APIModel):
    day: int = Field(ge=1, le=60)
    title: str = Field(max_length=160)
    activity_ids: list[str] = Field(default_factory=list)


class ItineraryDecision(APIModel):
    days: list[ItineraryAssignment]


class RouteLeg(APIModel):
    from_label: str
    to_label: str
    distance_meters: int | None = Field(default=None, ge=0)
    duration_seconds: int | None = Field(default=None, ge=0)


class MapRoute(APIModel):
    kind: Literal["trip_overview", "daily_round_trip"]
    day: int | None = None
    origin: LocationRef
    destination: LocationRef
    ordered_stops: list[LocationRef] = Field(default_factory=list)
    legs: list[RouteLeg] = Field(default_factory=list)
    distance_meters: int | None = Field(default=None, ge=0)
    duration_seconds: int | None = Field(default=None, ge=0)
    encoded_polyline: str | None = None
    google_maps_url: str
    source: SourceRef | None = None
    warnings: list[str] = Field(default_factory=list)


class ItineraryStop(APIModel):
    sequence: int = Field(ge=1)
    place: PlaceCandidate


class ItineraryDay(APIModel):
    day: int = Field(ge=1, le=60)
    date: Date | None = None
    title: str
    stops: list[ItineraryStop] = Field(default_factory=list)
    route: MapRoute | None = None


class BudgetSummary(APIModel):
    currency: CurrencyCode
    budget_total: float | None = None
    known_cost_total: float = Field(default=0, ge=0)
    remaining_from_known_costs: float | None = None
    coverage: Literal["complete", "partial", "unavailable"]
    unknown_cost_categories: list[str] = Field(default_factory=list)
    is_within_budget: bool | None = None
    notes: list[str] = Field(default_factory=list)


class ValidationIssue(APIModel):
    code: str
    message: str
    severity: Literal["error", "warning"]
    retry_nodes: list[str] = Field(default_factory=list)
    details: dict[str, Any] = Field(default_factory=dict)


class TripPlan(APIModel):
    status: Literal["valid", "invalid"]
    requirements: TripRequirements
    scope: TripScope
    selected_stay: PlaceCandidate | None = None
    itinerary: list[ItineraryDay] = Field(default_factory=list)
    trip_overview_route: MapRoute | None = None
    budget: BudgetSummary
    validation: list[ValidationIssue] = Field(default_factory=list)
    research_warnings: list[str] = Field(default_factory=list)


class GooglePhotoPayload(APIModel):
    name: str
    width_px: int | None = Field(default=None, gt=0)
    height_px: int | None = Field(default=None, gt=0)
    author_name: str | None = None
    author_uri: str | None = None
    author_photo_uri: str | None = None
    google_maps_uri: str | None = None
    flag_content_uri: str | None = None


class GoogleReviewPayload(APIModel):
    name: str
    rating: float = Field(ge=0, le=5)
    text: str | None = None
    relative_publish_time_description: str | None = None
    publish_time: str | None = None
    author_name: str | None = None
    author_uri: str | None = None
    author_photo_uri: str | None = None
    google_maps_uri: str | None = None
    flag_content_uri: str | None = None


class GoogleOpeningHoursPayload(APIModel):
    open_now: bool | None = None
    weekday_descriptions: list[str] = Field(default_factory=list, max_length=7)
    next_open_time: str | None = None
    next_close_time: str | None = None


class GooglePlacePayload(APIModel):
    id: str
    display_name: str
    formatted_address: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    rating: float | None = None
    user_rating_count: int | None = None
    google_maps_uri: str | None = None
    website_uri: str | None = None
    types: list[str] = Field(default_factory=list)
    price_level: str | None = None
    business_status: str | None = None
    national_phone_number: str | None = None
    international_phone_number: str | None = None
    editorial_summary: str | None = None
    amenities: list[str] = Field(default_factory=list)
    photos: list[GooglePhotoPayload] = Field(default_factory=list, max_length=10)
    reviews: list[GoogleReviewPayload] = Field(default_factory=list, max_length=5)
    opening_hours: GoogleOpeningHoursPayload | None = None

    @field_validator("display_name")
    @classmethod
    def display_name_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("display_name cannot be blank")
        return value.strip()

    def coordinates(self) -> Coordinates | None:
        if self.latitude is None or self.longitude is None:
            return None
        return Coordinates(latitude=self.latitude, longitude=self.longitude)
