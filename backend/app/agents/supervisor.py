import re
from typing import Any

from langgraph.types import StreamWriter

from app.agents.common import emit
from app.graph.state import TripState
from app.llm.base import PlanningModel
from app.schemas.common import LocationInput, ResolvedLocation
from app.schemas.hotel import HotelSearchConstraints, HotelSearchMode
from app.schemas.trip import (
    ClarificationOption,
    ClarificationQuestion,
    Intent,
    PlanTripRequest,
    TravelMode,
    TripRequestDraft,
    TripRequirements,
)


class SupervisorAgent:
    name = "supervisor"

    def __init__(self, model: PlanningModel) -> None:
        self._model = model

    async def __call__(self, state: TripState, writer: StreamWriter) -> dict[str, Any]:
        request = state["request"]
        emit(
            writer,
            "agent.started",
            self.name,
            "Understanding the trip request",
            {"model": self._model.name},
        )
        draft = await self._model.extract_trip(request.message)
        draft = _infer_search_semantics(draft, request.message)
        draft = _apply_answers(draft, request)
        conversation_title = (
            await self._model.suggest_title(request.message)
            if request.conversation_id is None and draft.intent != Intent.GENERAL
            else ""
        )
        if draft.intent == Intent.GENERAL:
            emit(
                writer,
                "agent.completed",
                self.name,
                "General conversation selected",
                {"intent": draft.intent.value},
            )
            return {
                "draft": draft,
                "clarifications": [],
                "conversation_title": conversation_title,
            }
        questions = _clarification_questions(draft)
        if questions:
            emit(
                writer,
                "clarification.required",
                self.name,
                "A few choices are needed before research can start",
                {
                    "questions": [question.model_dump(mode="json") for question in questions],
                    "draft": draft.model_dump(mode="json"),
                },
            )
            return {
                "draft": draft,
                "clarifications": questions,
                "conversation_title": conversation_title,
            }

        if draft.intent == Intent.HOTEL_SEARCH:
            constraints = _hotel_constraints(draft)
            emit(
                writer,
                "agent.completed",
                self.name,
                "Hotel search requirements are structured",
                {
                    "intent": draft.intent.value,
                    "mode": (draft.hotel_search_mode or HotelSearchMode.EXPLORATORY).value,
                    "constraints": constraints.model_dump(mode="json"),
                },
            )
            return {
                "draft": draft,
                "hotel_search": constraints,
                "clarifications": [],
                "conversation_title": conversation_title,
            }

        requirements = _to_requirements(draft, request.origin)
        emit(
            writer,
            "agent.completed",
            self.name,
            "Trip requirements are structured",
            {"requirements": requirements.model_dump(mode="json")},
        )
        return {
            "draft": draft,
            "requirements": requirements,
            "clarifications": [],
            "conversation_title": conversation_title,
        }


def _apply_answers(draft: TripRequestDraft, request: PlanTripRequest) -> TripRequestDraft:
    values = draft.model_dump()
    answers = request.answers
    if request.intent:
        values["intent"] = request.intent
    if request.hotel_search:
        values["hotel_search"] = request.hotel_search.model_dump()
    if request.selected_hotel:
        values["selected_hotel"] = request.selected_hotel.model_dump()
        if request.selected_hotel.check_in and not values.get("start_date"):
            values["start_date"] = request.selected_hotel.check_in
        if request.selected_hotel.check_out and not values.get("end_date"):
            values["end_date"] = request.selected_hotel.check_out
        selected_offer = request.selected_hotel.selected_offer
        if selected_offer and selected_offer.occupancy and not values.get("travelers"):
            values["travelers"] = selected_offer.occupancy
    if request.origin:
        values["origin"] = request.origin.address or request.origin.label or "Current location"

    scalar_fields = {
        "destination",
        "origin",
        "budget_band",
        "pace",
        "currency",
    }
    for field in scalar_fields:
        answer = answers.get(field)
        if isinstance(answer, str) and answer.strip():
            values[field] = answer.strip()

    hotel_values = dict(values.get("hotel_search") or {})
    if request.origin and values.get("intent") == Intent.HOTEL_SEARCH:
        hotel_values["location"] = ResolvedLocation(
            label=request.origin.label or request.origin.address or "Current location",
            formatted_address=request.origin.address,
            place_id=request.origin.place_id,
            coordinates=request.origin.coordinates,
            provider_ids=(
                {"google_places": request.origin.place_id} if request.origin.place_id else {}
            ),
        ).model_dump()
    hotel_location = answers.get("hotel_location")
    if isinstance(hotel_location, str) and hotel_location.strip():
        values["destination"] = hotel_location.strip()
        hotel_values["destination_query"] = hotel_location.strip()

    for field in ("check_in", "check_out"):
        answer = answers.get(field)
        if isinstance(answer, str) and answer.strip():
            hotel_values[field] = answer.strip()

    for field in ("adults", "rooms"):
        answer = answers.get(field)
        if answer is not None:
            try:
                hotel_values[field] = int(answer)
            except (TypeError, ValueError):
                pass

    max_price = answers.get("max_total_price")
    if max_price is not None:
        try:
            hotel_values["max_total_price"] = float(str(max_price).replace(",", ""))
        except ValueError:
            pass

    if hotel_values:
        values["hotel_search"] = hotel_values

    for field in ("travelers", "duration_days"):
        answer = answers.get(field)
        if answer is not None:
            try:
                values[field] = _answer_number(answer)
            except (TypeError, ValueError):
                pass

    budget_answer = answers.get("budget_total")
    if budget_answer is not None:
        try:
            values["budget_total"] = float(str(budget_answer).replace(",", ""))
        except ValueError:
            pass

    interests = answers.get("interests")
    if isinstance(interests, list):
        values["interests"] = [str(item).strip() for item in interests if str(item).strip()]
    elif isinstance(interests, str) and interests.strip():
        values["interests"] = [
            item.strip() for item in interests.split(",") if item.strip()
        ]

    preferences = answers.get("preferences")
    if isinstance(preferences, list):
        values["preferences"] = [str(item).strip() for item in preferences if str(item).strip()]

    mode = answers.get("travel_mode")
    if isinstance(mode, str):
        try:
            values["travel_mode"] = TravelMode(mode.upper())
        except ValueError:
            pass

    if values.get("budget_total") is not None and values.get("budget_band") is None:
        values["budget_band"] = "balanced"
    merged = TripRequestDraft.model_validate(values)
    if merged.intent == Intent.HOTEL_SEARCH:
        if merged.hotel_search_mode is None:
            merged = merged.model_copy(
                update={"hotel_search_mode": HotelSearchMode.EXPLORATORY}
            )
        constraints = _hotel_constraints(merged)
        if merged.hotel_search_mode == HotelSearchMode.BOOKABLE and constraints.adults:
            constraints = constraints.model_copy(update={"rooms": constraints.rooms or 1})
        merged = merged.model_copy(update={"hotel_search": constraints})
    return merged


def _answer_number(answer: Any) -> int:
    if isinstance(answer, (int, float)):
        return int(answer)
    match = re.search(r"\d+", str(answer))
    if not match:
        raise ValueError("answer does not contain a number")
    return int(match.group())


def _infer_search_semantics(draft: TripRequestDraft, message: str) -> TripRequestDraft:
    """Fill routing semantics deterministically while preserving extracted facts."""

    lower = message.lower()
    updates: dict[str, Any] = {}
    intent = draft.intent
    explicitly_plans_trip = bool(
        re.search(
            r"\b(plan|build|create|organize)\b.+\btrip\b|\bitinerary\b|"
            r"\b(?:solo|family|couples?|business)\s+trip\b|"
            r"\btrip\s+(?:to|from)\b|\btravel\s+(?:to|from)\b",
            lower,
        )
    )
    if explicitly_plans_trip:
        # A full-trip request may also ask for accommodation. Hotel details are part
        # of that itinerary rather than a reason to route to standalone hotel search.
        intent = Intent.FULL_TRIP_PLAN
        if draft.intent != intent:
            updates["intent"] = intent
    elif intent is None:
        intent = (
            Intent.HOTEL_SEARCH
            if re.search(r"\b(hotels?|lodging|accommodation|places? to stay)\b", lower)
            else Intent.GENERAL
        )
        updates["intent"] = intent

    if intent == Intent.HOTEL_SEARCH and draft.hotel_search_mode is None:
        requests_live_data = bool(
            re.search(
                r"\b(bookable|available|availability|book|price|pricing|rates?|under|"
                r"budget|costs?|from\s+[a-z]+\s+\d{1,2})\b|[$â‚¬Â£]",
                lower,
            )
        )
        updates["hotel_search_mode"] = (
            HotelSearchMode.BOOKABLE
            if requests_live_data
            else HotelSearchMode.EXPLORATORY
        )

    return draft.model_copy(update=updates) if updates else draft


def _clarification_questions(draft: TripRequestDraft) -> list[ClarificationQuestion]:
    if draft.intent == Intent.HOTEL_SEARCH:
        return _hotel_clarification_questions(draft)

    questions: list[ClarificationQuestion] = []
    if not draft.destination:
        questions.append(
            ClarificationQuestion(
                id="destination",
                prompt="Where would you like to travel?",
                kind="text",
            )
        )
    if not draft.origin:
        questions.append(
            ClarificationQuestion(
                id="origin",
                prompt="Where should the round trip start and end?",
                kind="location",
            )
        )
    if draft.travelers is None:
        questions.append(
            ClarificationQuestion(
                id="travelers",
                prompt="How many people are traveling?",
                kind="single_select",
                options=[
                    ClarificationOption(value="1", label="Solo"),
                    ClarificationOption(value="2", label="Two people"),
                    ClarificationOption(value="4", label="3–4 people"),
                    ClarificationOption(value="6", label="5+ people"),
                ],
            )
        )
    if draft.duration_days is None:
        questions.append(
            ClarificationQuestion(
                id="duration_days",
                prompt="How long should the trip be?",
                kind="single_select",
                options=[
                    ClarificationOption(value="3", label="Long weekend"),
                    ClarificationOption(value="5", label="4–5 days"),
                    ClarificationOption(value="7", label="One week"),
                    ClarificationOption(value="14", label="Two weeks"),
                ],
            )
        )
    return questions


def _hotel_clarification_questions(
    draft: TripRequestDraft,
) -> list[ClarificationQuestion]:
    constraints = _hotel_constraints(draft)
    questions: list[ClarificationQuestion] = []
    if not constraints.location and not constraints.destination_query and not draft.origin:
        questions.append(
            ClarificationQuestion(
                id="hotel_location",
                prompt="Where should I search for hotels?",
                kind="location",
            )
        )

    if draft.hotel_search_mode != HotelSearchMode.BOOKABLE:
        return questions

    if not constraints.check_in:
        questions.append(
            ClarificationQuestion(
                id="check_in",
                prompt="What is your check-in date?",
                kind="text",
            )
        )
    if not constraints.check_out:
        questions.append(
            ClarificationQuestion(
                id="check_out",
                prompt="What is your check-out date?",
                kind="text",
            )
        )
    if constraints.adults is None:
        questions.append(
            ClarificationQuestion(
                id="adults",
                prompt="How many adults need accommodation?",
                kind="single_select",
                options=[
                    ClarificationOption(value="1", label="One adult"),
                    ClarificationOption(value="2", label="Two adults"),
                    ClarificationOption(value="3", label="Three adults"),
                    ClarificationOption(value="4", label="Four adults"),
                ],
            )
        )
    return questions


def _hotel_constraints(draft: TripRequestDraft) -> HotelSearchConstraints:
    constraints = draft.hotel_search or HotelSearchConstraints()
    updates: dict[str, Any] = {}
    if not constraints.destination_query and draft.destination:
        updates["destination_query"] = draft.destination
    if constraints.adults is None and draft.travelers is not None:
        updates["adults"] = draft.travelers
    if constraints.check_in is None and draft.start_date is not None:
        updates["check_in"] = draft.start_date
    if constraints.check_out is None and draft.end_date is not None:
        updates["check_out"] = draft.end_date
    if constraints.max_total_price is None and draft.budget_total is not None:
        updates["max_total_price"] = draft.budget_total
    if constraints.currency != draft.currency:
        updates["currency"] = draft.currency
    return constraints.model_copy(update=updates)


def _to_requirements(
    draft: TripRequestDraft,
    explicit_origin: LocationInput | None = None,
) -> TripRequirements:
    origin = explicit_origin or LocationInput(label=draft.origin, address=draft.origin)
    return TripRequirements(
        destination=draft.destination or "",
        origin=origin,
        travelers=draft.travelers or 1,
        duration_days=draft.duration_days or 1,
        start_date=draft.start_date,
        end_date=draft.end_date,
        dates_flexible=draft.dates_flexible,
        budget_total=draft.budget_total,
        budget_band=draft.budget_band or "flexible",
        currency=draft.currency,
        interests=draft.interests,
        preferences=draft.preferences,
        pace=draft.pace or "balanced",
        travel_mode=draft.travel_mode,
        selected_hotel=draft.selected_hotel,
    )
