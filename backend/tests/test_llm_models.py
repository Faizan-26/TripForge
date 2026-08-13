from app.core.config import Settings
from app.llm.factory import build_planning_model
from app.llm.local import LocalPlanningModel
from app.llm.openai import OpenAIPlanningModel
from app.schemas.trip import (
    GeneralAssistantResult,
    ItineraryAssignment,
    ItineraryDecision,
    ScopeDecision,
    TripRequestDraft,
    TripRequirements,
)


class _StructuredInvoker:
    def __init__(self, schema: type) -> None:
        self._schema = schema

    async def ainvoke(self, prompt: str):
        assert "TripForge" in prompt
        if self._schema.__name__ == "_TripIntakeExtraction":
            return self._schema(
                destination="Islamabad",
                origin="Lahore",
                travelers=2,
                duration_days=3,
                interests=["food"],
            )
        if self._schema is ScopeDecision:
            return ScopeDecision(
                base_regions=["Islamabad"],
                rationale="Dummy structured model response.",
            )
        if self._schema is ItineraryDecision:
            return ItineraryDecision(
                days=[
                    ItineraryAssignment(
                        day=1,
                        title="Dummy day",
                        activity_ids=[],
                    )
                ]
            )
        if self._schema is GeneralAssistantResult:
            return GeneralAssistantResult(
                message="I can help with travel questions, hotels, or trip planning.",
                conversation_title="Travel help",
            )
        if self._schema.__name__ == "_ConversationTitle":
            return self._schema(title="Islamabad trip")
        raise AssertionError(f"Unexpected schema: {self._schema}")


class _UppercaseHotelModeInvoker:
    async def ainvoke(self, prompt: str):
        return {
            "intent": "HOTEL_SEARCH",
            "hotel_search_mode": "EXPLORATORY",
            "destination": "Islamabad",
            "origin": "",
            "travelers": 0,
            "duration_days": 0,
            "start_date": "",
            "end_date": "",
            "budget_total": -1,
            "budget_band": "UNSPECIFIED",
            "currency": "USD",
            "interests": [],
            "preferences": [],
            "pace": "UNSPECIFIED",
            "travel_mode": "DRIVE",
            "dates_flexible": True,
            "hotel_search": {
                "destination_query": "Islamabad",
                "check_in": "",
                "check_out": "",
                "adults": 0,
                "children": 0,
                "child_ages": [],
                "rooms": 0,
                "currency": "USD",
                "min_total_price": -1,
                "max_total_price": -1,
                "min_guest_rating": -1,
                "min_star_rating": -1,
                "required_amenity_codes": [],
                "property_types": [],
                "refundable_only": False,
                "preferences": [],
                "radius_km": -1,
            },
        }


class _UppercaseHotelModeModelStub:
    def with_structured_output(self, schema: type, *, method: str):
        assert method == "json_schema"
        return _UppercaseHotelModeInvoker()


class _StructuredModelStub:
    requested_schemas: list[type] = []

    def with_structured_output(self, schema: type, *, method: str):
        assert method == "json_schema"
        self.requested_schemas.append(schema)
        return _StructuredInvoker(schema)


def test_model_factory_uses_local_fallback_without_credentials() -> None:
    model = build_planning_model(Settings(openai_api_key=None, supabase_auth_required=False))

    assert isinstance(model, LocalPlanningModel)
    assert model.name == "local-fallback"


async def test_openai_adapter_contract_with_dummy_structured_model() -> None:
    model = object.__new__(OpenAIPlanningModel)
    model.name = "openai:dummy"
    model._model = _StructuredModelStub()
    requirements = TripRequirements(
        destination="Islamabad",
        origin={"address": "Lahore"},
        travelers=2,
        duration_days=3,
        interests=["food"],
    )

    draft = await model.extract_trip("Plan a dummy trip")
    scope = await model.decide_scope(requirements)
    itinerary = await model.arrange_itinerary(requirements, None, [])
    general = await model.answer_general("Hello", [])
    title = await model.suggest_title("Plan a dummy trip")

    assert draft.destination == "Islamabad"
    assert scope.base_regions == ["Islamabad"]
    assert itinerary.days[0].title == "Dummy day"
    assert general.intent == "GENERAL"
    assert title == "Islamabad trip"


async def test_openai_intake_uses_a_strict_schema_without_provider_id_maps() -> None:
    model = object.__new__(OpenAIPlanningModel)
    model.name = "openai:dummy"
    stub = _StructuredModelStub()
    stub.requested_schemas = []
    model._model = stub

    draft = await model.extract_trip(
        "I want to plan trip to Islamabad from Lahore, I need hotel details as well"
    )

    intake_schema = stub.requested_schemas[0]
    json_schema = intake_schema.model_json_schema()
    serialized_schema = str(json_schema)
    assert "provider_ids" not in serialized_schema
    assert "ResolvedLocation" not in serialized_schema
    assert "anyOf" not in serialized_schema
    for field in ("intent", "hotel_search_mode", "budget_band", "pace"):
        field_schema = json_schema["properties"][field]
        assert field_schema["type"] == "string"
        assert "enum" not in field_schema
    assert draft.destination == "Islamabad"
    assert draft.origin == "Lahore"
    assert draft.intent is None


async def test_openai_intake_normalizes_uppercase_hotel_search_mode() -> None:
    model = object.__new__(OpenAIPlanningModel)
    model.name = "openai-compatible:dummy"
    model._model = _UppercaseHotelModeModelStub()

    draft = await model.extract_trip("Find hotels in Islamabad")

    assert draft.intent.value == "HOTEL_SEARCH"
    assert draft.hotel_search_mode.value == "exploratory"
    assert draft.hotel_search is not None
    assert draft.hotel_search.destination_query == "Islamabad"
