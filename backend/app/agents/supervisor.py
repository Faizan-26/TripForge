from typing import Any

from langgraph.types import StreamWriter

from app.agents.common import emit
from app.graph.state import TripState
from app.llm.base import PlanningModel
from app.schemas.common import LocationInput
from app.schemas.trip import (
    ClarificationOption,
    ClarificationQuestion,
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
        draft = _apply_answers(draft, request)
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
            return {"draft": draft, "clarifications": questions}

        requirements = _to_requirements(draft, request.origin)
        emit(
            writer,
            "agent.completed",
            self.name,
            "Trip requirements are structured",
            {"requirements": requirements.model_dump(mode="json")},
        )
        return {"draft": draft, "requirements": requirements, "clarifications": []}


def _apply_answers(draft: TripRequestDraft, request: PlanTripRequest) -> TripRequestDraft:
    values = draft.model_dump()
    answers = request.answers
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

    for field in ("travelers", "duration_days"):
        answer = answers.get(field)
        if answer is not None:
            try:
                values[field] = int(answer)
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
    return TripRequestDraft.model_validate(values)


def _clarification_questions(draft: TripRequestDraft) -> list[ClarificationQuestion]:
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
    if not draft.interests:
        questions.append(
            ClarificationQuestion(
                id="interests",
                prompt="What should this trip prioritize?",
                kind="multi_select",
                options=[
                    ClarificationOption(value="nature", label="Nature"),
                    ClarificationOption(value="food", label="Food"),
                    ClarificationOption(value="culture", label="Culture"),
                    ClarificationOption(value="adventure", label="Adventure"),
                    ClarificationOption(value="relaxation", label="Relaxation"),
                    ClarificationOption(value="family", label="Family time"),
                ],
            )
        )
    if draft.pace is None:
        questions.append(
            ClarificationQuestion(
                id="pace",
                prompt="What pace feels right?",
                kind="single_select",
                options=[
                    ClarificationOption(value="relaxed", label="Relaxed"),
                    ClarificationOption(value="balanced", label="Balanced"),
                    ClarificationOption(value="active", label="Active"),
                ],
            )
        )
    if draft.budget_total is None and draft.budget_band is None:
        questions.append(
            ClarificationQuestion(
                id="budget_band",
                prompt="What spending style should guide recommendations?",
                kind="single_select",
                options=[
                    ClarificationOption(value="economy", label="Economy"),
                    ClarificationOption(value="balanced", label="Balanced"),
                    ClarificationOption(value="premium", label="Premium"),
                    ClarificationOption(value="flexible", label="Flexible"),
                ],
            )
        )
    return questions


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
    )
