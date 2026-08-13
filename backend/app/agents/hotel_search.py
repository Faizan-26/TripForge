from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlencode

from langgraph.types import StreamWriter

from app.agents.common import emit
from app.graph.state import TripState
from app.schemas.common import (
    Coordinates,
    Money,
    ProviderRef,
    ResolvedLocation,
)
from app.schemas.hotel import (
    AvailabilityStatus,
    HotelAmenity,
    HotelAvailability,
    HotelImage,
    HotelOffer,
    HotelOpeningHours,
    HotelPricing,
    HotelPropertyCandidate,
    HotelReview,
    HotelReviewSummary,
    HotelSearchMode,
    HotelSearchResult,
)
from app.schemas.trip import GooglePlacePayload
from app.tools.google_maps import (
    ExternalProviderError,
    GoogleMapsClient,
    ProviderNotConfiguredError,
)
from app.tools.tripvlog_dummy import TripVlogDummyClient, TripVlogPropertyPayload


class HotelSearchAgent:
    name = "hotel_search"

    def __init__(
        self,
        maps: GoogleMapsClient,
        tripvlog: TripVlogDummyClient,
        max_results: int,
    ) -> None:
        self._maps = maps
        self._tripvlog = tripvlog
        self._max_results = max_results

    async def __call__(self, state: TripState, writer: StreamWriter) -> dict[str, Any]:
        constraints = state["hotel_search"]
        mode = state["draft"].hotel_search_mode or HotelSearchMode.EXPLORATORY
        query = constraints.destination_query or constraints.location.label  # type: ignore[union-attr]
        emit(writer, "agent.started", self.name, "Searching grounded hotel properties")
        emit(
            writer,
            "tool.started",
            self.name,
            "Searching Google Places for hotels",
            {"query": query, "mode": mode.value},
        )
        warnings = [
            "Google supplies property identity, photos, reviews, published hours, and "
            "contact details when available. Star class, supplemental amenities, pricing, "
            "and availability remain deterministic TripVlog-shaped dummy data."
        ]
        try:
            places = await self._maps.search_places(
                f"hotels near {query}",
                max_results=self._max_results,
                included_type="lodging",
            )
        except (ProviderNotConfiguredError, ExternalProviderError) as exc:
            places = []
            warnings.append(str(exc))

        dummy_response = await self._tripvlog.enrich_properties(places, constraints, mode)
        properties = [
            _normalize_property(place, payload, constraints)
            for place, payload in zip(places, dummy_response.data.results, strict=True)
        ]
        source = ProviderRef(
            provider=self._tripvlog.provider_name,
            provider_id="concierge-properties-search",
            uri="/v1/internal/concierge/properties/search",
            retrieved_at=datetime.now(UTC),
        )
        result = HotelSearchResult(
            mode=mode,
            constraints=constraints,
            properties=properties,
            total_matches=dummy_response.data.total_records,
            warnings=warnings,
            sources=[source],
        )
        emit(
            writer,
            "tool.completed",
            self.name,
            f"Found {len(properties)} grounded hotel properties",
            {
                "count": len(properties),
                "identity_provider": "google_places",
                "enrichment_provider": self._tripvlog.provider_name,
            },
        )
        emit(writer, "agent.completed", self.name, "Hotel search results are ready")
        return {"hotel_result": result}


def _normalize_property(
    place: GooglePlacePayload,
    payload: TripVlogPropertyPayload,
    constraints: Any,
) -> HotelPropertyCandidate:
    tripvlog_source = ProviderRef(
        provider="tripvlog_dummy",
        provider_id=payload.property_id,
        uri=f"/v1/internal/concierge/properties/{payload.property_id}",
        retrieved_at=datetime.now(UTC),
    )
    google_source = ProviderRef(
        provider="google_places",
        provider_id=place.id,
        uri=place.google_maps_uri,
        retrieved_at=datetime.now(UTC),
    )
    offers: list[HotelOffer] = []
    if payload.price:
        price = payload.price
        subtotal = price.total_price - price.taxes_and_fees
        offers.append(
            HotelOffer(
                provider="tripvlog_dummy",
                offer_id=f"dummy-rate-{payload.property_id}",
                room_name="Standard room",
                occupancy=constraints.adults,
                pricing=HotelPricing(
                    currency=price.currency_code,
                    nightly_rate=Money(
                        amount=price.price_per_night,
                        currency=price.currency_code,
                    ),
                    subtotal=Money(amount=subtotal, currency=price.currency_code),
                    taxes_and_fees=Money(
                        amount=price.taxes_and_fees,
                        currency=price.currency_code,
                    ),
                    total=Money(amount=price.total_price, currency=price.currency_code),
                    price_is_estimate=True,
                    taxes_and_fees_included=True,
                ),
                availability=HotelAvailability(
                    status=AvailabilityStatus.AVAILABLE,
                    check_in=constraints.check_in,
                    check_out=constraints.check_out,
                    rooms_requested=constraints.rooms,
                    rooms_remaining=price.rooms_remaining,
                    checked_at=price.checked_at,
                    expires_at=price.expires_at,
                ),
                refundable=price.refundable,
                booking_url=None,
                source=tripvlog_source,
            )
        )

    coordinates = place.coordinates()
    return HotelPropertyCandidate(
        property_id=payload.property_id,
        provider_ids={
            "tripvlog_dummy": payload.property_id,
            "google_places": place.id,
        },
        name=payload.title,
        location=ResolvedLocation(
            label=payload.title,
            formatted_address=place.formatted_address,
            place_id=place.id,
            provider_ids={"google_places": place.id},
            coordinates=(
                Coordinates(
                    latitude=coordinates.latitude,
                    longitude=coordinates.longitude,
                )
                if coordinates
                else None
            ),
            google_maps_uri=place.google_maps_uri,
        ),
        property_types=[payload.kind.lower()],
        star_rating=payload.star_rating,
        review_summary=HotelReviewSummary(
            rating=place.rating or payload.review_summary.score,
            scale=5,
            review_count=place.user_rating_count or payload.review_summary.count,
        ),
        reviews=[
            HotelReview(
                review_id=review.name,
                rating=review.rating,
                text=review.text,
                relative_publish_time_description=(
                    review.relative_publish_time_description
                ),
                publish_time=review.publish_time,
                author_name=review.author_name,
                author_uri=review.author_uri,
                author_photo_uri=review.author_photo_uri,
                google_maps_uri=review.google_maps_uri,
                flag_content_uri=review.flag_content_uri,
                source=google_source,
            )
            for review in place.reviews
        ],
        amenities=[
            *[
                HotelAmenity(
                    code=_amenity_code(name),
                    name=name,
                    source=google_source,
                )
                for name in place.amenities
            ],
            *[
                HotelAmenity(
                    code=_amenity_code(name),
                    name=name,
                    details="TripVlog-shaped demo detail",
                    source=tripvlog_source,
                )
                for name in payload.associated_amenities
                if name not in place.amenities
            ],
        ],
        images=(
            [
                HotelImage(
                    id=photo.name,
                    url=f"/api/place-photos?{urlencode({'name': photo.name})}",
                    width=photo.width_px,
                    height=photo.height_px,
                    alt_text=f"Google Places photo of {payload.title}",
                    category="property",
                    attribution=photo.author_name,
                    attribution_url=photo.author_uri,
                    google_maps_uri=photo.google_maps_uri,
                    flag_content_uri=photo.flag_content_uri,
                    source=google_source,
                )
                for photo in place.photos
            ]
            if place.photos
            else [
                HotelImage(
                    id=f"dummy-hero-{payload.property_id}",
                    url=payload.hero_image.url,
                    alt_text=f"Dummy image for {payload.title}",
                    category="exterior",
                    attribution="TripVlog dummy data",
                    source=tripvlog_source,
                )
            ]
        ),
        description=place.editorial_summary,
        website_uri=place.website_uri,
        national_phone_number=place.national_phone_number,
        international_phone_number=place.international_phone_number,
        business_status=place.business_status,
        opening_hours=(
            HotelOpeningHours(
                open_now=place.opening_hours.open_now,
                weekday_descriptions=place.opening_hours.weekday_descriptions,
                next_open_time=place.opening_hours.next_open_time,
                next_close_time=place.opening_hours.next_close_time,
                source=google_source,
            )
            if place.opening_hours
            else None
        ),
        offers=offers,
        sources=[google_source, tripvlog_source],
    )


def _amenity_code(name: str) -> str:
    return "_".join(name.lower().replace("-", " ").split())
