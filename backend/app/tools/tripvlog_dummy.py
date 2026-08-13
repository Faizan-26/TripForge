from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta

from pydantic import Field

from app.schemas.common import APIModel
from app.schemas.hotel import HotelSearchConstraints, HotelSearchMode
from app.schemas.trip import GooglePlacePayload


class TripVlogHeroImagePayload(APIModel):
    url: str


class TripVlogReviewSummaryPayload(APIModel):
    score: float = Field(ge=0, le=5)
    count: int = Field(ge=0)


class TripVlogPricePayload(APIModel):
    price_per_night: float = Field(ge=0)
    total_price: float = Field(ge=0)
    taxes_and_fees: float = Field(ge=0)
    currency_code: str
    refundable: bool
    rooms_remaining: int = Field(ge=0)
    checked_at: datetime
    expires_at: datetime


class TripVlogPropertyPayload(APIModel):
    """Dummy payload matching TripVlog concierge discovery field names."""

    property_id: str
    property_detail_id: str
    provider_code: str
    provider_property_id: str
    title: str
    subtitle: str
    city: str | None = None
    country: str | None = None
    kind: str = "Hotel"
    star_rating: int = Field(ge=1, le=5)
    brand: str | None = None
    chain: str | None = None
    hero_image: TripVlogHeroImagePayload
    review_summary: TripVlogReviewSummaryPayload
    associated_amenities: list[str]
    coordinates: dict[str, float]
    is_closed: bool = False
    price: TripVlogPricePayload | None = None


class TripVlogSearchDataPayload(APIModel):
    results: list[TripVlogPropertyPayload]
    total_records: int = Field(ge=0)


class TripVlogSearchResponse(APIModel):
    status_code: int = 200
    message: str = "Concierge properties search completed"
    data: TripVlogSearchDataPayload


class TripVlogDummyClient:
    """Deterministic TripVlog-shaped enrichment; replace with HTTP calls later."""

    provider_name = "tripvlog_dummy"

    async def enrich_properties(
        self,
        places: list[GooglePlacePayload],
        constraints: HotelSearchConstraints,
        mode: HotelSearchMode,
    ) -> TripVlogSearchResponse:
        results = [self._property(place, constraints, mode) for place in places]
        return TripVlogSearchResponse(
            data=TripVlogSearchDataPayload(
                results=results,
                total_records=len(results),
            )
        )

    def _property(
        self,
        place: GooglePlacePayload,
        constraints: HotelSearchConstraints,
        mode: HotelSearchMode,
    ) -> TripVlogPropertyPayload:
        seed = int(hashlib.sha256(place.id.encode()).hexdigest()[:8], 16)
        property_id = str(100_000 + seed % 900_000)
        stars = 3 + seed % 3
        rating = place.rating or round(3.8 + (seed % 12) / 10, 1)
        amenities = ["Free Wi-Fi", "Parking"]
        if seed % 2 == 0:
            amenities.append("Breakfast available")
        if seed % 3 == 0:
            amenities.append("Airport transfer")

        price = None
        if mode == HotelSearchMode.BOOKABLE:
            nights = constraints.nights or 1
            ceiling = constraints.max_total_price
            base_nightly = round(70 + seed % 111, 2)
            if ceiling is not None:
                base_nightly = round(min(base_nightly, ceiling / nights * 0.82), 2)
            subtotal = round(base_nightly * nights, 2)
            taxes = round(subtotal * 0.12, 2)
            checked_at = datetime.now(UTC)
            price = TripVlogPricePayload(
                price_per_night=base_nightly,
                total_price=round(subtotal + taxes, 2),
                taxes_and_fees=taxes,
                currency_code=constraints.currency,
                refundable=seed % 2 == 0,
                rooms_remaining=1 + seed % 5,
                checked_at=checked_at,
                expires_at=checked_at + timedelta(minutes=15),
            )

        return TripVlogPropertyPayload(
            property_id=property_id,
            property_detail_id=str(1_000_000 + seed % 9_000_000),
            provider_code="GOOGLE_PLACES",
            provider_property_id=place.id,
            title=place.display_name,
            subtitle=f"{stars}-star Hotel",
            kind="Hotel",
            star_rating=stars,
            hero_image=TripVlogHeroImagePayload(
                url=f"https://tripvlog.example/dummy/properties/{property_id}/hero.jpg"
            ),
            review_summary=TripVlogReviewSummaryPayload(
                score=min(round(rating, 1), 5),
                count=place.user_rating_count or 25 + seed % 900,
            ),
            associated_amenities=amenities,
            coordinates={
                "lat": place.latitude or 0,
                "lng": place.longitude or 0,
            },
            price=price,
        )
