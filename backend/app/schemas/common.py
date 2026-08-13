from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

CurrencyCode = Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}$")]


class APIModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class Coordinates(APIModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class LocationInput(APIModel):
    label: str | None = Field(default=None, max_length=200)
    address: str | None = Field(default=None, max_length=500)
    place_id: str | None = Field(default=None, max_length=300)
    coordinates: Coordinates | None = None

    @model_validator(mode="after")
    def has_a_location(self) -> "LocationInput":
        if not any((self.address, self.place_id, self.coordinates)):
            raise ValueError("Provide an address, place_id, or coordinates")
        return self


class LocationRef(APIModel):
    label: str
    formatted_address: str | None = None
    place_id: str | None = None
    coordinates: Coordinates | None = None
    google_maps_uri: str | None = None


class SourceRef(APIModel):
    provider: Literal["google_places", "google_routes", "user"]
    provider_id: str | None = None
    uri: str | None = None
    retrieved_at: str | None = None


class ProviderRef(APIModel):
    """Identity and provenance for providers outside the legacy Google-only flow."""

    provider: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9][a-z0-9_-]*$")
    provider_id: str = Field(min_length=1, max_length=500)
    uri: str | None = Field(default=None, max_length=2000)
    retrieved_at: datetime | None = None


class ResolvedLocation(APIModel):
    """A provider-resolved location suitable for routing and deduplication."""

    label: str = Field(min_length=1, max_length=200)
    formatted_address: str | None = Field(default=None, max_length=500)
    place_id: str | None = Field(default=None, max_length=300)
    provider_ids: dict[str, str] = Field(default_factory=dict, max_length=12)
    coordinates: Coordinates | None = None
    city: str | None = Field(default=None, max_length=120)
    region: str | None = Field(default=None, max_length=120)
    country_code: str | None = Field(default=None, pattern=r"^[A-Z]{2}$")
    timezone: str | None = Field(default=None, max_length=100)
    google_maps_uri: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def has_resolved_identity(self) -> "ResolvedLocation":
        if not any(
            (
                self.formatted_address,
                self.place_id,
                self.provider_ids,
                self.coordinates,
            )
        ):
            raise ValueError(
                "A resolved location requires an address, place ID, provider ID, or coordinates"
            )
        if any(
            not provider.strip() or not provider_id.strip()
            for provider, provider_id in self.provider_ids.items()
        ):
            raise ValueError("provider_ids cannot contain blank providers or IDs")
        return self


class Money(APIModel):
    amount: float = Field(ge=0)
    currency: CurrencyCode = "USD"
