from __future__ import annotations

from datetime import UTC, date as Date, datetime
from enum import StrEnum
from typing import Literal
from uuid import UUID, uuid4

from pydantic import Field, model_validator

from app.schemas.common import APIModel, CurrencyCode, Money, ProviderRef, ResolvedLocation


class HotelSearchMode(StrEnum):
    EXPLORATORY = "exploratory"
    BOOKABLE = "bookable"


class AvailabilityStatus(StrEnum):
    UNKNOWN = "unknown"
    AVAILABLE = "available"
    UNAVAILABLE = "unavailable"
    LIMITED = "limited"


class HotelSearchConstraints(APIModel):
    """Constraints accumulated conversationally before property research."""

    destination_query: str | None = Field(default=None, min_length=1, max_length=500)
    location: ResolvedLocation | None = None
    check_in: Date | None = None
    check_out: Date | None = None
    adults: int | None = Field(default=None, ge=1, le=50)
    children: int = Field(default=0, ge=0, le=20)
    child_ages: list[int] = Field(default_factory=list, max_length=20)
    rooms: int | None = Field(default=None, ge=1, le=20)
    currency: CurrencyCode = "USD"
    min_total_price: float | None = Field(default=None, ge=0)
    max_total_price: float | None = Field(default=None, ge=0)
    min_guest_rating: float | None = Field(default=None, ge=0, le=10)
    min_star_rating: float | None = Field(default=None, ge=0, le=5)
    required_amenity_codes: list[str] = Field(default_factory=list, max_length=30)
    property_types: list[str] = Field(default_factory=list, max_length=20)
    refundable_only: bool = False
    preferences: list[str] = Field(default_factory=list, max_length=30)
    radius_km: float | None = Field(default=None, gt=0, le=500)

    @model_validator(mode="after")
    def validate_constraints(self) -> "HotelSearchConstraints":
        if self.check_in and self.check_out and self.check_out <= self.check_in:
            raise ValueError("check_out must be after check_in")
        if self.child_ages and len(self.child_ages) != self.children:
            raise ValueError("child_ages must contain one age for each child")
        if any(age < 0 or age > 17 for age in self.child_ages):
            raise ValueError("child ages must be between 0 and 17")
        if (
            self.min_total_price is not None
            and self.max_total_price is not None
            and self.min_total_price > self.max_total_price
        ):
            raise ValueError("min_total_price cannot exceed max_total_price")
        return self

    @property
    def nights(self) -> int | None:
        if not self.check_in or not self.check_out:
            return None
        return (self.check_out - self.check_in).days

    @property
    def supports_bookable_search(self) -> bool:
        return bool(
            (self.location or self.destination_query)
            and self.check_in
            and self.check_out
            and self.adults
            and self.rooms
        )


class HotelImage(APIModel):
    id: str | None = Field(default=None, max_length=500)
    url: str = Field(min_length=1, max_length=3000)
    width: int | None = Field(default=None, gt=0)
    height: int | None = Field(default=None, gt=0)
    alt_text: str | None = Field(default=None, max_length=500)
    category: str | None = Field(default=None, max_length=80)
    attribution: str | None = Field(default=None, max_length=500)
    attribution_url: str | None = Field(default=None, max_length=2000)
    google_maps_uri: str | None = Field(default=None, max_length=2000)
    flag_content_uri: str | None = Field(default=None, max_length=2000)
    source: ProviderRef | None = None


class HotelAmenity(APIModel):
    code: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=200)
    category: str | None = Field(default=None, max_length=100)
    available: bool = True
    details: str | None = Field(default=None, max_length=500)
    source: ProviderRef | None = None


class HotelReview(APIModel):
    review_id: str = Field(min_length=1, max_length=500)
    rating: float = Field(ge=0, le=5)
    text: str | None = Field(default=None, max_length=5000)
    relative_publish_time_description: str | None = Field(default=None, max_length=120)
    publish_time: datetime | None = None
    author_name: str | None = Field(default=None, max_length=300)
    author_uri: str | None = Field(default=None, max_length=2000)
    author_photo_uri: str | None = Field(default=None, max_length=3000)
    google_maps_uri: str | None = Field(default=None, max_length=2000)
    flag_content_uri: str | None = Field(default=None, max_length=2000)
    source: ProviderRef


class HotelOpeningHours(APIModel):
    open_now: bool | None = None
    weekday_descriptions: list[str] = Field(default_factory=list, max_length=7)
    next_open_time: datetime | None = None
    next_close_time: datetime | None = None
    source: ProviderRef


class HotelReviewSummary(APIModel):
    rating: float = Field(ge=0)
    scale: float = Field(default=10, gt=0, le=100)
    review_count: int = Field(ge=0)
    label: str | None = Field(default=None, max_length=80)
    subratings: dict[str, float] = Field(default_factory=dict, max_length=20)

    @model_validator(mode="after")
    def rating_uses_scale(self) -> "HotelReviewSummary":
        if self.rating > self.scale:
            raise ValueError("rating cannot exceed its scale")
        if any(value < 0 or value > self.scale for value in self.subratings.values()):
            raise ValueError("subratings must use the declared rating scale")
        return self


class HotelPricing(APIModel):
    currency: CurrencyCode
    nightly_rate: Money | None = None
    subtotal: Money | None = None
    taxes_and_fees: Money | None = None
    total: Money | None = None
    price_is_estimate: bool = False
    taxes_and_fees_included: bool | None = None

    @model_validator(mode="after")
    def prices_use_declared_currency(self) -> "HotelPricing":
        amounts = (self.nightly_rate, self.subtotal, self.taxes_and_fees, self.total)
        if any(amount and amount.currency != self.currency for amount in amounts):
            raise ValueError("all price components must use the declared currency")
        return self


class HotelAvailability(APIModel):
    status: AvailabilityStatus = AvailabilityStatus.UNKNOWN
    check_in: Date | None = None
    check_out: Date | None = None
    rooms_requested: int | None = Field(default=None, ge=1, le=20)
    rooms_remaining: int | None = Field(default=None, ge=0)
    checked_at: datetime | None = None
    expires_at: datetime | None = None

    @model_validator(mode="after")
    def validate_availability(self) -> "HotelAvailability":
        if self.check_in and self.check_out and self.check_out <= self.check_in:
            raise ValueError("check_out must be after check_in")
        if (
            self.status == AvailabilityStatus.UNAVAILABLE
            and self.rooms_remaining not in (None, 0)
        ):
            raise ValueError("unavailable offers cannot report rooms remaining")
        for field_name, value in (
            ("checked_at", self.checked_at),
            ("expires_at", self.expires_at),
        ):
            if value and (value.tzinfo is None or value.utcoffset() is None):
                raise ValueError(f"{field_name} must include a timezone")
        if self.checked_at and self.expires_at:
            checked_at = self.checked_at.astimezone(UTC)
            expires_at = self.expires_at.astimezone(UTC)
            if expires_at <= checked_at:
                raise ValueError("expires_at must be after checked_at")
        return self


class HotelOffer(APIModel):
    provider: str = Field(min_length=1, max_length=80)
    offer_id: str = Field(min_length=1, max_length=500)
    room_name: str | None = Field(default=None, max_length=300)
    meal_plan: str | None = Field(default=None, max_length=200)
    occupancy: int | None = Field(default=None, ge=1, le=50)
    pricing: HotelPricing | None = None
    availability: HotelAvailability
    refundable: bool | None = None
    cancellable_until: datetime | None = None
    booking_url: str | None = Field(default=None, max_length=3000)
    source: ProviderRef


class HotelPropertyCandidate(APIModel):
    """Normalized property identity with zero or more provider-backed offers."""

    property_id: str = Field(min_length=1, max_length=500)
    provider_ids: dict[str, str] = Field(min_length=1, max_length=12)
    name: str = Field(min_length=1, max_length=300)
    location: ResolvedLocation
    property_types: list[str] = Field(default_factory=list, max_length=20)
    star_rating: float | None = Field(default=None, ge=0, le=5)
    review_summary: HotelReviewSummary | None = None
    reviews: list[HotelReview] = Field(default_factory=list, max_length=5)
    amenities: list[HotelAmenity] = Field(default_factory=list, max_length=100)
    images: list[HotelImage] = Field(default_factory=list, max_length=50)
    description: str | None = Field(default=None, max_length=5000)
    website_uri: str | None = Field(default=None, max_length=2000)
    national_phone_number: str | None = Field(default=None, max_length=100)
    international_phone_number: str | None = Field(default=None, max_length=100)
    business_status: str | None = Field(default=None, max_length=80)
    opening_hours: HotelOpeningHours | None = None
    offers: list[HotelOffer] = Field(default_factory=list, max_length=50)
    sources: list[ProviderRef] = Field(min_length=1, max_length=12)

    @model_validator(mode="after")
    def provider_ids_are_complete(self) -> "HotelPropertyCandidate":
        if any(
            not provider.strip() or not provider_id.strip()
            for provider, provider_id in self.provider_ids.items()
        ):
            raise ValueError("provider_ids cannot contain blank providers or IDs")
        return self


class HotelSearchResult(APIModel):
    search_id: UUID = Field(default_factory=uuid4)
    mode: HotelSearchMode
    constraints: HotelSearchConstraints
    properties: list[HotelPropertyCandidate] = Field(default_factory=list)
    total_matches: int | None = Field(default=None, ge=0)
    has_more: bool = False
    warnings: list[str] = Field(default_factory=list, max_length=50)
    sources: list[ProviderRef] = Field(default_factory=list, max_length=20)
    searched_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @model_validator(mode="after")
    def validate_result(self) -> "HotelSearchResult":
        if self.total_matches is not None and self.total_matches < len(self.properties):
            raise ValueError("total_matches cannot be less than returned properties")
        if self.mode == HotelSearchMode.BOOKABLE and not self.constraints.supports_bookable_search:
            raise ValueError("bookable search requires location, dates, adults, and rooms")
        return self


class SelectedHotelContext(APIModel):
    """Immutable property snapshot carried from hotel search into trip planning."""

    search_id: UUID
    property_id: str = Field(min_length=1, max_length=500)
    provider_ids: dict[str, str] = Field(min_length=1, max_length=12)
    name: str = Field(min_length=1, max_length=300)
    location: ResolvedLocation
    selected_offer: HotelOffer | None = None
    check_in: Date | None = None
    check_out: Date | None = None
    selection_source: Literal["traveler", "system"] = "traveler"
    selected_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @model_validator(mode="after")
    def validate_selection(self) -> "SelectedHotelContext":
        if self.check_in and self.check_out and self.check_out <= self.check_in:
            raise ValueError("check_out must be after check_in")
        if any(
            not provider.strip() or not provider_id.strip()
            for provider, provider_id in self.provider_ids.items()
        ):
            raise ValueError("provider_ids cannot contain blank providers or IDs")
        if self.selected_offer:
            offer_property_id = self.provider_ids.get(self.selected_offer.provider)
            if not offer_property_id:
                raise ValueError("selected offer provider must identify the selected property")
        return self


# A concise alias for callers that use generic property terminology.
PropertyCandidate = HotelPropertyCandidate
HotelCandidate = HotelPropertyCandidate
