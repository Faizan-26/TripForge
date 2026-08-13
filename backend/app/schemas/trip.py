from __future__ import annotations

from datetime import date as Date
from enum import StrEnum
from typing import Any, Literal
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


class TravelMode(StrEnum):
    DRIVE = "DRIVE"
    WALK = "WALK"
    BICYCLE = "BICYCLE"
    TRANSIT = "TRANSIT"


AnswerValue = str | int | float | bool | list[str]


class PlanTripRequest(APIModel):
    message: str = Field(min_length=3, max_length=6000)
    conversation_id: UUID | None = None
    client_request_id: UUID | None = None
    client_message_id: UUID | None = None
    title: str | None = Field(default=None, min_length=1, max_length=200)
    answers: dict[str, AnswerValue] = Field(default_factory=dict)
    origin: LocationInput | None = None
    parent_run_id: UUID | None = None


class TripRequestDraft(APIModel):
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

    @model_validator(mode="after")
    def derive_duration(self) -> TripRequestDraft:
        if self.start_date and self.end_date:
            if self.end_date < self.start_date:
                raise ValueError("end_date cannot be before start_date")
            if self.duration_days is None:
                self.duration_days = (self.end_date - self.start_date).days + 1
        return self


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
    interests: list[str] = Field(min_length=1, max_length=12)
    preferences: list[str] = Field(default_factory=list, max_length=20)
    pace: Literal["relaxed", "balanced", "active"] = "balanced"
    travel_mode: TravelMode = TravelMode.DRIVE


class ClarificationOption(APIModel):
    value: str
    label: str
    description: str | None = None


class ClarificationQuestion(APIModel):
    id: str
    prompt: str
    kind: Literal["single_select", "multi_select", "text", "location", "number"]
    required: bool = True
    options: list[ClarificationOption] = Field(default_factory=list)


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
