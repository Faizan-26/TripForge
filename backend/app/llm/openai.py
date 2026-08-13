import json
from datetime import date

from langchain_openai import ChatOpenAI
from pydantic import Field

from app.llm.base import PlanningModel
from app.schemas.common import APIModel
from app.schemas.hotel import HotelSearchMode
from app.schemas.trip import (
    ConversationTurn,
    GeneralAssistantResult,
    Intent,
    ItineraryDecision,
    PlaceCandidate,
    ScopeDecision,
    TravelMode,
    TripRequestDraft,
    TripRequirements,
)


class _HotelSearchExtraction(APIModel):
    """Hotel facts the intake model can extract without inventing provider data."""

    destination_query: str = Field(default="", max_length=500)
    check_in: str = ""
    check_out: str = ""
    adults: int = Field(default=0, ge=0, le=50)
    children: int = Field(default=0, ge=0, le=20)
    child_ages: list[int] = Field(default_factory=list, max_length=20)
    rooms: int = Field(default=0, ge=0, le=20)
    currency: str = "USD"
    min_total_price: float = -1
    max_total_price: float = -1
    min_guest_rating: float = Field(default=-1, le=10)
    min_star_rating: float = Field(default=-1, le=5)
    required_amenity_codes: list[str] = Field(default_factory=list, max_length=30)
    property_types: list[str] = Field(default_factory=list, max_length=20)
    refundable_only: bool = False
    preferences: list[str] = Field(default_factory=list, max_length=30)
    radius_km: float = Field(default=-1, le=500)


class _TripIntakeExtraction(APIModel):
    """Strict OpenAI response schema, deliberately excluding provider-resolved objects."""

    # Keep model-generated classifications as plain strings. Some compatible
    # providers enforce enums before returning output, so a harmless casing choice
    # can otherwise become an HTTP 400. Values are normalized into domain enums below.
    intent: str = "UNSPECIFIED"
    hotel_search_mode: str = "UNSPECIFIED"
    destination: str = ""
    origin: str = ""
    travelers: int = Field(default=0, ge=0, le=50)
    duration_days: int = Field(default=0, ge=0, le=60)
    start_date: str = ""
    end_date: str = ""
    budget_total: float = -1
    budget_band: str = "UNSPECIFIED"
    currency: str = "USD"
    interests: list[str] = Field(default_factory=list, max_length=12)
    preferences: list[str] = Field(default_factory=list, max_length=20)
    pace: str = "UNSPECIFIED"
    travel_mode: str = "DRIVE"
    dates_flexible: bool = True
    hotel_search: _HotelSearchExtraction = Field(default_factory=_HotelSearchExtraction)


class _ConversationTitle(APIModel):
    title: str = Field(min_length=1, max_length=80)


class OpenAIPlanningModel(PlanningModel):
    def __init__(self, *, api_key: str, model: str, base_url: str | None = None) -> None:
        provider = "openai-compatible" if base_url else "openai"
        self.name = f"{provider}:{model}"
        model_options = {"api_key": api_key, "model": model}
        if base_url:
            model_options["base_url"] = base_url
        self._model = ChatOpenAI(**model_options)

    async def extract_trip(self, message: str) -> TripRequestDraft:
        # TripRequestDraft also carries provider-resolved context such as arbitrary
        # provider-ID mappings. OpenAI strict response schemas reject those mappings,
        # and intake should never ask the model to manufacture them in the first place.
        structured = self._model.with_structured_output(
            _TripIntakeExtraction,
            method="json_schema",
        )
        prompt = f"""
You are the intake component of TripForge. Extract only facts explicitly stated by the
traveler. Do not guess missing destinations, locations, dates, people, costs, interests,
or preferences. Extract every fact that is present before leaving a field empty.

Set intent to HOTEL_SEARCH when the traveler primarily asks to find hotels, lodging, or
accommodation. Set it to FULL_TRIP_PLAN only when they ask for a trip or itinerary to be
planned. Use GENERAL for greetings, general travel discussion, destination questions,
or any message that is not yet a request to search hotels or build a trip. Set
hotel_search_mode to the uppercase
value EXPLORATORY or BOOKABLE. Use UNSPECIFIED for an enum field only when it cannot be
determined from the message. For hotel searches, put the requested
area or landmark in both destination and hotel_search.destination_query. "Nearby" alone
is not a resolved destination. Set hotel_search_mode to BOOKABLE only when the traveler
explicitly requests availability, booking, live prices/rates, gives a price constraint,
or supplies stay dates. Otherwise use EXPLORATORY. Exploratory hotel searches do not
need dates, guests, rooms, or a budget. Copy explicit hotel dates, guests, currency, and
price ceiling into hotel_search. A broad destination such as a country is valid.
Use ISO dates. Use an empty string for missing text or date fields, 0 for missing counts,
and -1 for missing prices or ratings. Today is {date.today().isoformat()}.

Traveler message:
{message}
""".strip()
        extracted = await structured.ainvoke(prompt)
        if not isinstance(extracted, _TripIntakeExtraction):
            extracted = _TripIntakeExtraction.model_validate(extracted)
        values = extracted.model_dump()
        intent = str(values.get("intent", "")).upper()
        values["intent"] = intent if intent in {item.value for item in Intent} else None
        hotel_mode = str(values.get("hotel_search_mode", "")).lower()
        values["hotel_search_mode"] = (
            hotel_mode if hotel_mode in {item.value for item in HotelSearchMode} else None
        )
        for field, allowed in (
            ("budget_band", {"economy", "balanced", "premium", "flexible"}),
            ("pace", {"relaxed", "balanced", "active"}),
        ):
            normalized = str(values.get(field, "")).lower()
            values[field] = normalized if normalized in allowed else None
        travel_mode = str(values.get("travel_mode", "")).upper()
        values["travel_mode"] = (
            travel_mode if travel_mode in {item.value for item in TravelMode} else "DRIVE"
        )
        currency = str(values.get("currency", "USD")).upper()
        values["currency"] = currency if len(currency) == 3 and currency.isalpha() else "USD"
        for field in ("destination", "origin", "start_date", "end_date"):
            if not values.get(field):
                values[field] = None
        for field in ("travelers", "duration_days"):
            if values.get(field) == 0:
                values[field] = None
        if values.get("budget_total", -1) < 0:
            values["budget_total"] = None

        hotel_values = values["hotel_search"]
        hotel_currency = str(hotel_values.get("currency", values["currency"])).upper()
        hotel_values["currency"] = (
            hotel_currency
            if len(hotel_currency) == 3 and hotel_currency.isalpha()
            else values["currency"]
        )
        for field in ("destination_query", "check_in", "check_out"):
            if not hotel_values.get(field):
                hotel_values[field] = None
        for field in ("adults", "rooms"):
            if hotel_values.get(field) == 0:
                hotel_values[field] = None
        for field in (
            "min_total_price",
            "max_total_price",
            "min_guest_rating",
            "min_star_rating",
            "radius_km",
        ):
            if hotel_values.get(field, -1) < 0:
                hotel_values[field] = None
        if not any(
            value not in (None, [], False, 0, "USD")
            for value in hotel_values.values()
        ):
            values["hotel_search"] = None
        return TripRequestDraft.model_validate(values)

    async def answer_general(
        self, message: str, context: list[ConversationTurn]
    ) -> GeneralAssistantResult:
        structured = self._model.with_structured_output(
            GeneralAssistantResult,
            method="json_schema",
        )
        history = "\n".join(f"{turn.role}: {turn.content}" for turn in context[-8:])
        prompt = f"""
You are TripForge's conversational travel assistant. Respond naturally and concisely.
You can discuss travel, explain how TripForge works, and help a traveler move toward
either a grounded hotel search or a complete trip plan. Do not claim to have searched
providers, checked live availability, or built an itinerary in this general branch.
When useful, tell the traveler they can ask you to find hotels or plan a trip. Do not
force those actions when they are simply chatting. Return intent exactly as GENERAL.
Create a short, specific conversation_title of at most seven words based on the user's
first topic; do not use punctuation or generic labels such as New trip.

Recent conversation:
{history or "No earlier messages"}

User: {message}
""".strip()
        result = await structured.ainvoke(prompt)
        return (
            result
            if isinstance(result, GeneralAssistantResult)
            else GeneralAssistantResult.model_validate(result)
        )

    async def suggest_title(self, message: str) -> str:
        structured = self._model.with_structured_output(
            _ConversationTitle,
            method="json_schema",
        )
        prompt = f"""
Name this TripForge conversation from the user's first message. Use at most seven words,
no ending punctuation, and describe the actual topic. For a greeting with no topic, use
Travel conversation.

First message: {message}
""".strip()
        result = await structured.ainvoke(prompt)
        if not isinstance(result, _ConversationTitle):
            result = _ConversationTitle.model_validate(result)
        return result.title.strip()[:80]

    async def decide_scope(self, trip: TripRequirements) -> ScopeDecision:
        structured = self._model.with_structured_output(ScopeDecision, method="json_schema")
        prompt = f"""
You are TripForge's Trip Scope Agent. Establish shared geographic constraints before
parallel research. Select at most three coherent base regions for this trip length and
pace. Avoid combining distant regions when transit would dominate the trip. Do not name
hotels or attractions. This is a planning decision, not live-data research.

Trip requirements:
{trip.model_dump_json()}
""".strip()
        return await structured.ainvoke(prompt)

    async def arrange_itinerary(
        self,
        trip: TripRequirements,
        stay: PlaceCandidate | None,
        activities: list[PlaceCandidate],
    ) -> ItineraryDecision:
        structured = self._model.with_structured_output(ItineraryDecision, method="json_schema")
        entities = [
            {
                "provider_id": item.provider_id,
                "name": item.name,
                "types": item.types,
                "rating": item.rating,
                "address": item.location.formatted_address,
            }
            for item in activities
        ]
        prompt = f"""
You are TripForge's Itinerary Agent. Arrange only the supplied, provider-grounded
activity IDs into {trip.duration_days} days. Never create an ID, place, price, opening
time, or travel time. Use every ID at most once. Keep pacing {trip.pace}; empty days are
allowed when research is insufficient.

Trip requirements:
{trip.model_dump_json()}

Selected stay:
{stay.model_dump_json() if stay else "null"}

Allowed activities:
{json.dumps(entities)}
""".strip()
        return await structured.ainvoke(prompt)
