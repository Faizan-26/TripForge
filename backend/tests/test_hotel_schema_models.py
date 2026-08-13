from datetime import UTC, date, datetime, timedelta
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.common import Coordinates, Money, ProviderRef, ResolvedLocation
from app.schemas.hotel import (
    AvailabilityStatus,
    HotelAmenity,
    HotelAvailability,
    HotelImage,
    HotelOffer,
    HotelPricing,
    HotelPropertyCandidate,
    HotelReviewSummary,
    HotelSearchConstraints,
    HotelSearchMode,
    HotelSearchResult,
    SelectedHotelContext,
)
from app.schemas.trip import DynamicTripDraft, Intent, PlanTripRequest, TripRequestDraft


def _location() -> ResolvedLocation:
    return ResolvedLocation(
        label="Karimabad",
        formatted_address="Karimabad, Hunza, Gilgit-Baltistan, Pakistan",
        place_id="google-place-karimabad",
        provider_ids={"google_places": "google-place-karimabad"},
        coordinates=Coordinates(latitude=36.3256, longitude=74.6698),
        city="Karimabad",
        region="Gilgit-Baltistan",
        country_code="PK",
        timezone="Asia/Karachi",
    )


def _source(provider_id: str = "hotel-123") -> ProviderRef:
    return ProviderRef(
        provider="test_hotels",
        provider_id=provider_id,
        uri="https://provider.example/hotels/hotel-123",
        retrieved_at=datetime.now(UTC),
    )


def _offer() -> HotelOffer:
    checked_at = datetime.now(UTC)
    return HotelOffer(
        provider="test_hotels",
        offer_id="offer-456",
        room_name="Mountain-view double room",
        occupancy=2,
        pricing=HotelPricing(
            currency="PKR",
            nightly_rate=Money(amount=22000, currency="PKR"),
            subtotal=Money(amount=66000, currency="PKR"),
            taxes_and_fees=Money(amount=9900, currency="PKR"),
            total=Money(amount=75900, currency="PKR"),
            taxes_and_fees_included=True,
        ),
        availability=HotelAvailability(
            status=AvailabilityStatus.AVAILABLE,
            check_in=date(2027, 6, 10),
            check_out=date(2027, 6, 13),
            rooms_requested=1,
            rooms_remaining=2,
            checked_at=checked_at,
            expires_at=checked_at + timedelta(minutes=15),
        ),
        refundable=True,
        booking_url="https://provider.example/book/offer-456",
        source=_source("offer-456"),
    )


def _property() -> HotelPropertyCandidate:
    return HotelPropertyCandidate(
        property_id="tripforge-hotel-1",
        provider_ids={
            "google_places": "google-hotel-1",
            "test_hotels": "hotel-123",
        },
        name="Hunza View Hotel",
        location=_location(),
        property_types=["hotel"],
        star_rating=4,
        review_summary=HotelReviewSummary(
            rating=8.8,
            scale=10,
            review_count=421,
            label="Excellent",
            subratings={"location": 9.2, "cleanliness": 8.6},
        ),
        amenities=[
            HotelAmenity(code="wifi", name="Free Wi-Fi"),
            HotelAmenity(code="parking", name="Parking"),
        ],
        images=[
            HotelImage(
                id="image-1",
                url="https://images.example/hotel-1.jpg",
                width=1600,
                height=1067,
                alt_text="Hunza View Hotel exterior",
                source=_source("image-1"),
            )
        ],
        offers=[_offer()],
        sources=[_source()],
    )


def test_existing_trip_contracts_remain_valid_with_new_intent_fields() -> None:
    legacy = TripRequestDraft(destination="Hunza", origin="Karachi", travelers=2)
    request = PlanTripRequest(message="Plan a trip from Karachi to Hunza")

    assert isinstance(legacy, DynamicTripDraft)
    assert legacy.intent is None
    assert request.intent is None
    assert request.hotel_search is None
    assert request.selected_hotel is None


def test_dynamic_draft_supports_full_trip_and_standalone_hotel_intents() -> None:
    constraints = HotelSearchConstraints(destination_query="Hunza", adults=2)
    hotel_draft = DynamicTripDraft(
        intent=Intent.HOTEL_SEARCH,
        destination="Hunza",
        travelers=2,
        hotel_search=constraints,
    )
    trip_draft = DynamicTripDraft(
        intent=Intent.FULL_TRIP_PLAN,
        destination="Hunza",
        origin="Karachi",
        start_date=date(2027, 6, 10),
        end_date=date(2027, 6, 14),
    )

    assert hotel_draft.hotel_search == constraints
    assert trip_draft.duration_days == 5


def test_exploratory_constraints_allow_missing_dates_but_bookable_results_do_not() -> None:
    exploratory_constraints = HotelSearchConstraints(
        destination_query="Hunza",
        adults=2,
        preferences=["quiet", "mountain view"],
    )
    exploratory = HotelSearchResult(
        mode=HotelSearchMode.EXPLORATORY,
        constraints=exploratory_constraints,
        properties=[],
    )

    assert exploratory.constraints.nights is None
    assert not exploratory.constraints.supports_bookable_search

    with pytest.raises(ValidationError, match="bookable search requires"):
        HotelSearchResult(
            mode=HotelSearchMode.BOOKABLE,
            constraints=exploratory_constraints,
        )


def test_bookable_hotel_result_round_trips_provider_grounded_property_data() -> None:
    constraints = HotelSearchConstraints(
        location=_location(),
        check_in=date(2027, 6, 10),
        check_out=date(2027, 6, 13),
        adults=2,
        rooms=1,
        currency="PKR",
        max_total_price=100000,
        required_amenity_codes=["wifi", "parking"],
        refundable_only=True,
    )
    result = HotelSearchResult(
        mode=HotelSearchMode.BOOKABLE,
        constraints=constraints,
        properties=[_property()],
        total_matches=1,
        sources=[_source()],
    )

    restored = HotelSearchResult.model_validate(result.model_dump(mode="json"))

    assert restored == result
    assert restored.constraints.nights == 3
    assert restored.constraints.supports_bookable_search
    assert restored.properties[0].location.coordinates == Coordinates(
        latitude=36.3256,
        longitude=74.6698,
    )
    assert restored.properties[0].provider_ids["test_hotels"] == "hotel-123"
    assert restored.properties[0].offers[0].pricing is not None
    assert restored.properties[0].offers[0].pricing.total == Money(
        amount=75900,
        currency="PKR",
    )


def test_selected_hotel_context_can_continue_into_trip_planning() -> None:
    search_id = uuid4()
    candidate = _property()
    selected = SelectedHotelContext(
        search_id=search_id,
        property_id=candidate.property_id,
        provider_ids=candidate.provider_ids,
        name=candidate.name,
        location=candidate.location,
        selected_offer=candidate.offers[0],
        check_in=date(2027, 6, 10),
        check_out=date(2027, 6, 13),
    )
    request = PlanTripRequest(
        message="Continue planning with this hotel",
        intent=Intent.FULL_TRIP_PLAN,
        selected_hotel=selected,
    )

    assert request.selected_hotel is not None
    assert request.selected_hotel.search_id == search_id
    assert request.selected_hotel.location.place_id == "google-place-karimabad"


@pytest.mark.parametrize(
    "constraints, message",
    [
        (
            {"destination_query": "Hunza", "check_in": "2027-06-13", "check_out": "2027-06-10"},
            "check_out must be after check_in",
        ),
        (
            {"destination_query": "Hunza", "children": 2, "child_ages": [8]},
            "one age for each child",
        ),
        (
            {"destination_query": "Hunza", "min_total_price": 1000, "max_total_price": 500},
            "min_total_price cannot exceed",
        ),
    ],
)
def test_hotel_constraints_reject_inconsistent_values(
    constraints: dict[str, object],
    message: str,
) -> None:
    with pytest.raises(ValidationError, match=message):
        HotelSearchConstraints.model_validate(constraints)


def test_hotel_pricing_and_reviews_reject_inconsistent_scales_and_currencies() -> None:
    with pytest.raises(ValidationError, match="rating cannot exceed"):
        HotelReviewSummary(rating=11, scale=10, review_count=5)

    with pytest.raises(ValidationError, match="declared currency"):
        HotelPricing(
            currency="USD",
            total=Money(amount=100, currency="PKR"),
        )

    with pytest.raises(ValidationError, match="rooms remaining"):
        HotelAvailability(
            status=AvailabilityStatus.UNAVAILABLE,
            rooms_remaining=1,
        )

    with pytest.raises(ValidationError, match="expires_at must be after"):
        now = datetime.now(UTC)
        HotelAvailability(
            status=AvailabilityStatus.AVAILABLE,
            checked_at=now,
            expires_at=now - timedelta(minutes=1),
        )


def test_selected_offer_must_belong_to_a_provider_for_the_selected_property() -> None:
    candidate = _property()
    offer = candidate.offers[0].model_copy(update={"provider": "different_provider"})

    with pytest.raises(ValidationError, match="offer provider"):
        SelectedHotelContext(
            search_id=uuid4(),
            property_id=candidate.property_id,
            provider_ids=candidate.provider_ids,
            name=candidate.name,
            location=candidate.location,
            selected_offer=offer,
        )
