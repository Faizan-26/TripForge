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


class Money(APIModel):
    amount: float = Field(ge=0)
    currency: CurrencyCode = "USD"
