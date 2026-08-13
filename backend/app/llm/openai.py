import json
from datetime import date

from langchain_openai import ChatOpenAI

from app.llm.base import PlanningModel
from app.schemas.trip import (
    ItineraryDecision,
    PlaceCandidate,
    ScopeDecision,
    TripRequestDraft,
    TripRequirements,
)


class OpenAIPlanningModel(PlanningModel):
    def __init__(self, *, api_key: str, model: str) -> None:
        self.name = f"openai:{model}"
        self._model = ChatOpenAI(api_key=api_key, model=model)

    async def extract_trip(self, message: str) -> TripRequestDraft:
        structured = self._model.with_structured_output(TripRequestDraft, method="json_schema")
        prompt = f"""
You are the intake component of TripForge. Extract only facts explicitly stated by the
traveler. Do not guess missing destinations, locations, dates, people, costs, interests,
or preferences. A broad destination such as a country is still a valid destination.
Use ISO dates. Today is {date.today().isoformat()}.

Traveler message:
{message}
""".strip()
        return await structured.ainvoke(prompt)

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
