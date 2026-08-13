from app.core.config import Settings
from app.llm.factory import build_planning_model
from app.llm.local import LocalPlanningModel
from app.llm.openai import OpenAIPlanningModel
from app.schemas.trip import (
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
        if self._schema is TripRequestDraft:
            return TripRequestDraft(
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
        raise AssertionError(f"Unexpected schema: {self._schema}")


class _StructuredModelStub:
    def with_structured_output(self, schema: type, *, method: str):
        assert method == "json_schema"
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

    assert draft.destination == "Islamabad"
    assert scope.base_regions == ["Islamabad"]
    assert itinerary.days[0].title == "Dummy day"
