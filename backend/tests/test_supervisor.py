from app.agents.supervisor import _apply_answers, _clarification_questions, _to_requirements
from app.llm.local import LocalPlanningModel
from app.schemas.common import LocationInput
from app.schemas.trip import PlanTripRequest, TripRequestDraft


async def test_local_intake_extracts_only_explicit_trip_details() -> None:
    model = LocalPlanningModel()
    draft = await model.extract_trip(
        "Plan a relaxed 5-day trip from Lahore to Islamabad for two people "
        "under $1,500. We like food and culture."
    )

    assert draft.origin == "Lahore"
    assert draft.destination == "Islamabad"
    assert draft.duration_days == 5
    assert draft.travelers == 2
    assert draft.budget_total == 1500
    assert draft.interests == ["food", "culture"]
    assert draft.pace == "relaxed"


def test_missing_values_become_typed_clarification_questions() -> None:
    questions = _clarification_questions(TripRequestDraft(destination="Islamabad"))
    question_map = {question.id: question for question in questions}

    assert question_map["origin"].kind == "location"
    assert question_map["travelers"].kind == "single_select"
    assert question_map["interests"].kind == "multi_select"
    assert question_map["pace"].options[1].value == "balanced"


def test_explicit_origin_object_and_answers_override_draft() -> None:
    request = PlanTripRequest(
        message="Plan a trip to Islamabad",
        origin=LocationInput(
            label="Current location",
            coordinates={"latitude": 31.5204, "longitude": 74.3587},
        ),
        answers={
            "travelers": "2",
            "duration_days": "4",
            "interests": ["food"],
            "pace": "balanced",
            "budget_band": "flexible",
        },
    )
    merged = _apply_answers(TripRequestDraft(destination="Islamabad"), request)

    assert merged.origin == "Current location"
    assert merged.travelers == 2
    assert merged.duration_days == 4
    assert merged.interests == ["food"]

    requirements = _to_requirements(merged, request.origin)
    assert requirements.origin.coordinates is not None
    assert requirements.origin.coordinates.latitude == 31.5204
