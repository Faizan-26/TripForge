import pytest

from app.agents.supervisor import (
    _apply_answers,
    _clarification_questions,
    _infer_search_semantics,
    _to_requirements,
)
from app.llm.local import LocalPlanningModel
from app.schemas.common import LocationInput
from app.schemas.hotel import HotelSearchMode
from app.schemas.trip import Intent, PlanTripRequest, TripRequestDraft


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


@pytest.mark.parametrize("message", ["hiii", "What can you help me with?", "Tell me about travel"])
async def test_general_messages_do_not_enter_trip_clarification(message: str) -> None:
    draft = await LocalPlanningModel().extract_trip(message)
    draft = _infer_search_semantics(draft, message)

    assert draft.intent == Intent.GENERAL
    assert _clarification_questions(draft) == []


async def test_general_assistant_points_to_tripforge_capabilities() -> None:
    result = await LocalPlanningModel().answer_general("hiii", [])

    assert result.intent == "GENERAL"
    assert "find hotels" in result.message.lower()
    assert "trip plan" in result.message.lower()
    assert result.conversation_title == "Travel conversation"


def test_missing_values_become_typed_clarification_questions() -> None:
    questions = _clarification_questions(TripRequestDraft(destination="Islamabad"))
    question_map = {question.id: question for question in questions}

    assert question_map["origin"].kind == "location"
    assert question_map["travelers"].kind == "single_select"
    assert question_map["duration_days"].kind == "single_select"
    assert "interests" not in question_map
    assert "pace" not in question_map
    assert "budget_band" not in question_map


def test_custom_numeric_answer_is_accepted_and_revalidated() -> None:
    request = PlanTripRequest(
        message="Plan a trip from Lahore to Islamabad",
        answers={"travelers": "12 travelers", "duration_days": "9 days"},
    )
    merged = _apply_answers(
        TripRequestDraft(
            intent=Intent.FULL_TRIP_PLAN,
            destination="Islamabad",
            origin="Lahore",
        ),
        request,
    )

    assert merged.travelers == 12
    assert merged.duration_days == 9
    assert _clarification_questions(merged) == []


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


@pytest.mark.parametrize(
    ("message", "expected_intent", "expected_mode", "expected_question_ids"),
    [
        (
            "Plan a 5-day trip to Paris for two people",
            Intent.FULL_TRIP_PLAN,
            None,
            {"origin"},
        ),
        (
            "Find hotels near Dubai Mall",
            Intent.HOTEL_SEARCH,
            HotelSearchMode.EXPLORATORY,
            set(),
        ),
        (
            "Find hotels near Dubai Mall under $180",
            Intent.HOTEL_SEARCH,
            HotelSearchMode.BOOKABLE,
            {"check_in", "check_out", "adults"},
        ),
        (
            "Find hotels nearby",
            Intent.HOTEL_SEARCH,
            HotelSearchMode.EXPLORATORY,
            {"hotel_location"},
        ),
        (
            "Bookable hotels in Rome from June 10 to June 14",
            Intent.HOTEL_SEARCH,
            HotelSearchMode.BOOKABLE,
            {"adults"},
        ),
    ],
)
async def test_dynamic_clarification_asks_only_necessary_questions(
    message: str,
    expected_intent: Intent,
    expected_mode: HotelSearchMode | None,
    expected_question_ids: set[str],
) -> None:
    draft = await LocalPlanningModel().extract_trip(message)
    draft = _infer_search_semantics(draft, message)
    questions = _clarification_questions(draft)

    assert draft.intent == expected_intent
    assert draft.hotel_search_mode == expected_mode
    assert {question.id for question in questions} == expected_question_ids


async def test_exploratory_hotel_search_keeps_dates_travelers_and_budget_optional() -> None:
    draft = await LocalPlanningModel().extract_trip("Find hotels near Dubai Mall")
    question_ids = {question.id for question in _clarification_questions(draft)}

    assert draft.destination == "Dubai Mall"
    assert draft.hotel_search is not None
    assert draft.hotel_search.destination_query == "Dubai Mall"
    assert not question_ids & {"check_in", "check_out", "adults", "max_total_price"}


async def test_hotel_budget_is_extracted_before_bookable_clarification() -> None:
    draft = await LocalPlanningModel().extract_trip("Find hotels near Dubai Mall under $180")

    assert draft.hotel_search is not None
    assert draft.hotel_search.max_total_price == 180
    assert draft.hotel_search.currency == "USD"
    assert {question.id for question in _clarification_questions(draft)} == {
        "check_in",
        "check_out",
        "adults",
    }


async def test_bookable_dates_are_extracted_before_asking_for_guests() -> None:
    draft = await LocalPlanningModel().extract_trip(
        "Bookable hotels in Rome from June 10 to June 14"
    )

    assert draft.hotel_search is not None
    assert draft.hotel_search.check_in is not None
    assert draft.hotel_search.check_out is not None
    assert draft.hotel_search.check_in.month == 6
    assert draft.hotel_search.check_in.day == 10
    assert draft.hotel_search.check_out.month == 6
    assert draft.hotel_search.check_out.day == 14
    assert {question.id for question in _clarification_questions(draft)} == {"adults"}


async def test_nearby_hotel_search_uses_explicit_origin_without_location_question() -> None:
    model = LocalPlanningModel()
    draft = await model.extract_trip("Find hotels nearby")
    request = PlanTripRequest(
        message="Find hotels nearby",
        origin=LocationInput(
            label="Current location",
            coordinates={"latitude": 25.1972, "longitude": 55.2744},
        ),
    )
    merged = _apply_answers(draft, request)

    assert merged.hotel_search is not None
    assert merged.hotel_search.location is not None
    assert merged.hotel_search.location.coordinates is not None
    assert _clarification_questions(merged) == []


def test_full_trip_defaults_optional_preferences_when_requirements_are_ready() -> None:
    draft = TripRequestDraft(
        intent=Intent.FULL_TRIP_PLAN,
        destination="Paris",
        origin="London",
        travelers=2,
        duration_days=5,
    )

    assert _clarification_questions(draft) == []
    requirements = _to_requirements(draft)
    assert requirements.interests == []
    assert requirements.pace == "balanced"
    assert requirements.budget_band == "flexible"


async def test_selected_hotel_phrase_does_not_override_explicit_trip_plan_intent() -> None:
    message = "Plan a 3-day trip to Dubai using my selected hotel"
    draft = await LocalPlanningModel().extract_trip(message)

    assert draft.intent == Intent.FULL_TRIP_PLAN


async def test_trip_request_with_hotel_details_stays_in_full_trip_flow() -> None:
    message = (
        "I want to plan trip to Islamabad from Lahore, I need hotel details as well"
    )
    draft = await LocalPlanningModel().extract_trip(message)
    draft = _infer_search_semantics(draft, message)

    assert draft.intent == Intent.FULL_TRIP_PLAN
    assert draft.destination == "Islamabad"
    assert draft.origin == "Lahore"
    assert {question.id for question in _clarification_questions(draft)} == {
        "travelers",
        "duration_days",
    }


def test_explicit_trip_language_overrides_incorrect_hotel_only_classification() -> None:
    message = "Plan a trip to Islamabad and include hotel details"
    draft = TripRequestDraft(
        intent=Intent.HOTEL_SEARCH,
        destination="Islamabad",
        origin="Lahore",
    )

    corrected = _infer_search_semantics(draft, message)

    assert corrected.intent == Intent.FULL_TRIP_PLAN
