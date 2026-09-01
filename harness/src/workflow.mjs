export const WORKFLOW_VERSION = "1";

export const WORKFLOW_MODES = Object.freeze([
  "UNKNOWN",
  "GENERAL_TRAVEL",
  "PLACES_SEARCH",
  "FULL_TRIP_PLAN",
  "OUT_OF_SCOPE",
]);

export const WORKFLOW_GOALS = Object.freeze([
  "request_understanding",
  "trip_requirements",
  "hotel_selection",
  "historical_places",
  "itinerary",
  "complete",
]);

const GOAL_STATUS = new Set(["pending", "in_progress", "completed", "skipped", "blocked"]);
const MODE_SET = new Set(WORKFLOW_MODES);
const GOAL_SET = new Set(WORKFLOW_GOALS);

export function prepareWorkflowContext(context = {}) {
  const normalized = normalizeWorkflowState(context.workflow);
  const contextualMode = firstKnownMode(
    normalized.mode,
    context.intent,
    context.draft?.intent,
  );
  const goals = { ...normalized.goals };
  if (normalized.mode === "UNKNOWN" && contextualMode !== "UNKNOWN") {
    goals.request_understanding = "completed";
    if (contextualMode === "FULL_TRIP_PLAN") {
      goals.trip_requirements = "in_progress";
    } else {
      goals.trip_requirements = "skipped";
      goals.hotel_selection = "skipped";
      goals.historical_places = "skipped";
      goals.itinerary = "skipped";
    }
  }
  const currentAnswers = new Set(recordKeys(context.answers));
  const lastRoundResolved = normalized.last_question_ids.length > 0
    && normalized.last_question_ids.every((questionId) => currentAnswers.has(questionId));
  if (
    contextualMode === "FULL_TRIP_PLAN"
    && normalized.current_goal === "trip_requirements"
    && normalized.requirements.complete_after_current_answers === true
    && lastRoundResolved
  ) {
    goals.trip_requirements = "completed";
    goals.hotel_selection = normalized.requirements.lodging_required === false
      ? "skipped"
      : "in_progress";
    goals.historical_places = normalized.requirements.historical_places_required === false
      ? "skipped"
      : "pending";
  }
  if (
    contextualMode === "FULL_TRIP_PLAN"
    && goals.hotel_selection === "in_progress"
    && hasSelectedHotel(context, isRecord(context.draft) ? context.draft : {})
  ) {
    goals.hotel_selection = "completed";
    goals.historical_places = normalized.requirements.historical_places_required === false
      ? "skipped"
      : "in_progress";
  }
  if (
    contextualMode === "FULL_TRIP_PLAN"
    && goals.historical_places === "in_progress"
    && normalized.evidence.historical_places_grounded
  ) {
    goals.historical_places = "completed";
    goals.itinerary = "in_progress";
  }
  if (
    contextualMode === "FULL_TRIP_PLAN"
    && goals.trip_requirements === "completed"
    && ["completed", "skipped"].includes(goals.hotel_selection)
    && ["completed", "skipped"].includes(goals.historical_places)
    && goals.itinerary === "pending"
  ) {
    goals.itinerary = "in_progress";
  }
  const answered = new Set([
    ...normalized.answered_question_ids,
    ...recordKeys(context.answers),
  ]);
  return finalize({
    ...normalized,
    mode: contextualMode,
    current_goal: nextGoal(goals),
    goals,
    answered_question_ids: [...answered].slice(-100),
  });
}

export function reduceWorkflow({ context = {}, result = {}, questions = [] } = {}) {
  const previous = prepareWorkflowContext(context);
  const update = isRecord(result.workflow_update) ? result.workflow_update : {};
  const draft = {
    ...(isRecord(context.draft) ? context.draft : {}),
    ...(isRecord(result.draft) ? result.draft : {}),
  };
  const mode = firstKnownMode(
    update.mode,
    result.mode,
    previous.mode,
    context.intent,
    draft.intent,
    inferPresentationMode(result.presentation),
  );
  const answered = new Set([
    ...previous.answered_question_ids,
    ...recordKeys(context.answers),
  ]);
  const questionIds = questions
    .map((question) => typeof question?.id === "string" ? question.id.trim() : "")
    .filter(Boolean)
    .slice(0, 12);
  const hotelQuestion = questions.find((question) => question?.id === "hotel_selection");
  const selectedHotel = hasSelectedHotel(context, draft);
  const hotelCandidatesGrounded = groundedHotelOptions(hotelQuestion);
  const lodgingRequired = booleanOr(
    update.lodging_required,
    previous.requirements.lodging_required,
    inferOvernightStay(draft),
  );
  const historicalPlacesRequired = booleanOr(
    update.historical_places_required,
    previous.requirements.historical_places_required,
    false,
  );
  const requirementsComplete = update.requirements_complete === true
    || questionIds.includes("hotel_selection")
    || result.presentation?.kind === "trip_plan";
  const goals = freshGoals();

  if (mode === "UNKNOWN") {
    goals.request_understanding = "in_progress";
  } else {
    goals.request_understanding = "completed";
  }

  if (["GENERAL_TRAVEL", "PLACES_SEARCH", "OUT_OF_SCOPE"].includes(mode)) {
    goals.trip_requirements = "skipped";
    goals.hotel_selection = "skipped";
    goals.historical_places = "skipped";
    goals.itinerary = "skipped";
    goals.complete = result.outcome === "general" ? "completed" : "pending";
  } else if (mode === "FULL_TRIP_PLAN") {
    goals.trip_requirements = requirementsComplete ? "completed" : "in_progress";
    goals.hotel_selection = lodgingRequired === false
      ? "skipped"
      : selectedHotel
      ? "completed"
      : hotelCandidatesGrounded || questionIds.includes("hotel_selection")
      ? "in_progress"
      : "pending";
    goals.historical_places = historicalPlacesRequired === false
      ? "skipped"
      : update.historical_places_grounded === true
        || previous.evidence.historical_places_grounded
      ? "completed"
      : "pending";

    const prerequisitesComplete = goals.trip_requirements === "completed"
      && ["completed", "skipped"].includes(goals.hotel_selection)
      && ["completed", "skipped"].includes(goals.historical_places);
    const itineraryReturned = result.outcome === "general"
      && result.presentation?.kind === "trip_plan";
    goals.itinerary = itineraryReturned && prerequisitesComplete
      ? "completed"
      : prerequisitesComplete
      ? "in_progress"
      : "pending";
    goals.complete = goals.itinerary === "completed" ? "completed" : "pending";
  }

  return finalize({
    version: WORKFLOW_VERSION,
    mode,
    locale: boundedText(update.locale ?? previous.locale, 40),
    turn: Math.min(10_000, previous.turn + 1),
    current_goal: nextGoal(goals),
    goals,
    requirements: {
      lodging_required: lodgingRequired,
      historical_places_required: historicalPlacesRequired,
      complete_after_current_answers:
        result.outcome === "clarification"
        && !questionIds.includes("hotel_selection")
        && update.requirements_complete_after_answers === true,
    },
    evidence: {
      hotel_candidates_grounded:
        previous.evidence.hotel_candidates_grounded || hotelCandidatesGrounded,
      historical_places_grounded:
        previous.evidence.historical_places_grounded
        || update.historical_places_grounded === true,
    },
    answered_question_ids: [...answered].slice(-100),
    last_question_ids: questionIds,
  });
}

export function normalizeWorkflowState(value) {
  const source = isRecord(value) && value.version === WORKFLOW_VERSION ? value : {};
  const goals = freshGoals();
  if (isRecord(source.goals)) {
    for (const goal of WORKFLOW_GOALS) {
      if (GOAL_STATUS.has(source.goals[goal])) goals[goal] = source.goals[goal];
    }
  }
  return finalize({
    version: WORKFLOW_VERSION,
    mode: normalizeMode(source.mode),
    locale: boundedText(source.locale, 40),
    turn: boundedInteger(source.turn, 0, 10_000),
    current_goal: GOAL_SET.has(source.current_goal)
      ? source.current_goal
      : "request_understanding",
    goals,
    requirements: {
      lodging_required: optionalBoolean(source.requirements?.lodging_required),
      historical_places_required: optionalBoolean(
        source.requirements?.historical_places_required,
      ),
      complete_after_current_answers: optionalBoolean(
        source.requirements?.complete_after_current_answers,
      ),
    },
    evidence: {
      hotel_candidates_grounded: source.evidence?.hotel_candidates_grounded === true,
      historical_places_grounded: source.evidence?.historical_places_grounded === true,
    },
    answered_question_ids: stringArray(source.answered_question_ids, 100),
    last_question_ids: stringArray(source.last_question_ids, 12),
  });
}

export function workflowResponseViolation({ context = {}, response = {}, evidence = {} } = {}) {
  if (!isRecord(context.workflow) || context.workflow.version !== WORKFLOW_VERSION) return undefined;
  const prepared = prepareWorkflowContext(context);
  const questions = Array.isArray(response.questions) ? response.questions : [];
  const draft = {
    ...(isRecord(context.draft) ? context.draft : {}),
    ...(isRecord(response.draft) ? response.draft : {}),
  };

  if (response.outcome === "clarification") {
    const unanswered = questions.filter((question) => (
      hasText(question?.id)
      && !isQuestionAnswered(question.id, context.answers, draft)
    ));
    if (unanswered.length === 0) {
      return violation(
        "REPEATED_QUESTIONS",
        "Every proposed question is already answered. Advance the workflow and submit the next required goal instead of asking again.",
      );
    }
  }

  if (prepared.next_action === "ground_and_present_hotel_choices") {
    const hotelQuestion = questions.find((question) => question?.id === "hotel_selection");
    if (
      response.outcome !== "clarification"
      || !hotelQuestion
      || evidence.hotel_search_grounded !== true
      || !groundedHotelOptions(hotelQuestion)
    ) {
      return violation(
        "HOTEL_SELECTION_REQUIRED",
        "The current goal is hotel selection. Call search_google_places with search_type hotel, then submit exactly one grounded hotel_selection question with 3 to 5 place-ID options. Do not draft the itinerary yet.",
      );
    }
  }

  if (
    prepared.next_action === "ground_historical_places"
    && evidence.historical_places_grounded !== true
  ) {
    return violation(
      "HISTORICAL_EVIDENCE_REQUIRED",
      "The current goal is historical-place research. Call search_google_places with search_type historical_place before submitting the itinerary.",
    );
  }

  if (response.outcome === "general" && response.presentation?.kind === "trip_plan") {
    const candidate = reduceWorkflow({
      context,
      result: {
        ...response,
        workflow_update: {
          ...(isRecord(response.workflow_update) ? response.workflow_update : {}),
          historical_places_grounded: evidence.historical_places_grounded === true,
        },
      },
    });
    if (candidate.goals.itinerary !== "completed") {
      const correction = candidate.current_goal === "hotel_selection"
        ? "Search for hotels and present grounded hotel cards before drafting the itinerary."
        : candidate.current_goal === "historical_places"
        ? "Ground the required historical places with Google Places before drafting the itinerary."
        : "Collect only the still-missing requirements before drafting the itinerary.";
      return violation("PREMATURE_ITINERARY", correction);
    }
  }
  return undefined;
}

export function isQuestionAnswered(questionId, answers = {}, draft = {}) {
  const aliases = ANSWER_ALIASES.find((group) => group.includes(questionId)) ?? [questionId];
  if (aliases.some((alias) => isRecord(answers) && Object.hasOwn(answers, alias))) return true;
  if (aliases.includes("origin")) return hasText(draft.origin);
  if (aliases.includes("destination")) {
    return hasText(draft.destination)
      || hasText(draft.hotel_search?.destination_query)
      || isRecord(draft.hotel_search?.location);
  }
  if (aliases.includes("travel_dates")) {
    return (hasText(draft.start_date) && hasText(draft.end_date))
      || Number.isFinite(draft.duration_days)
      || (hasText(draft.hotel_search?.check_in) && hasText(draft.hotel_search?.check_out));
  }
  if (aliases.includes("traveler_composition")) {
    return Number.isFinite(draft.travelers) || Number.isFinite(draft.hotel_search?.adults);
  }
  if (aliases.includes("budget")) {
    return Number.isFinite(draft.budget_total)
      || Number.isFinite(draft.hotel_search?.max_total_price);
  }
  if (aliases.includes("interests")) return nonEmptyArray(draft.interests);
  if (aliases.includes("preferred_pace")) return hasText(draft.pace);
  if (aliases.includes("constraints")) return nonEmptyArray(draft.preferences);
  if (aliases.includes("rooms")) return Number.isFinite(draft.hotel_search?.rooms);
  if (aliases.includes("hotel_must_haves")) return nonEmptyArray(draft.hotel_search?.amenities);
  if (aliases.includes("hotel_selection")) return isRecord(draft.selected_hotel);
  return false;
}

const ANSWER_ALIASES = [
  ["origin", "source", "departure", "departure_location"],
  ["destination", "destinations", "hotel_location", "location"],
  ["travel_dates", "trip_dates", "stay_dates", "date_range", "check_in", "check_out"],
  ["traveler_composition", "guest_composition", "travelers", "guests", "adults", "children"],
  ["budget", "budget_total", "hotel_budget", "max_total_price"],
  ["interests", "activities"],
  ["preferred_pace", "pace"],
  ["lodging_style", "accommodation_style"],
  ["constraints", "preferences", "transport_preferences"],
  ["rooms", "room_count"],
  ["hotel_must_haves", "must_haves"],
  ["hotel_selection", "selected_hotel"],
];

function finalize(state) {
  const currentGoal = GOAL_SET.has(state.current_goal)
    ? state.current_goal
    : nextGoal(state.goals);
  return {
    version: WORKFLOW_VERSION,
    mode: normalizeMode(state.mode),
    ...(state.locale ? { locale: state.locale } : {}),
    turn: boundedInteger(state.turn, 0, 10_000),
    current_goal: currentGoal,
    goals: state.goals,
    requirements: state.requirements,
    evidence: state.evidence,
    answered_question_ids: state.answered_question_ids,
    last_question_ids: state.last_question_ids,
    next_action: actionFor(currentGoal),
  };
}

function freshGoals() {
  return Object.fromEntries(WORKFLOW_GOALS.map((goal) => [goal, "pending"]));
}

function nextGoal(goals) {
  return WORKFLOW_GOALS.find((goal) => goals[goal] === "in_progress")
    ?? WORKFLOW_GOALS.find((goal) => goals[goal] === "pending")
    ?? "complete";
}

function actionFor(goal) {
  return {
    request_understanding: "classify_and_extract",
    trip_requirements: "ask_only_missing_requirements",
    hotel_selection: "ground_and_present_hotel_choices",
    historical_places: "ground_historical_places",
    itinerary: "compose_grounded_itinerary",
    complete: "respond_to_follow_up",
  }[goal];
}

function inferPresentationMode(presentation) {
  if (presentation?.kind === "trip_plan") return "FULL_TRIP_PLAN";
  return undefined;
}

function inferOvernightStay(draft) {
  if (Number.isFinite(draft.duration_days)) return draft.duration_days > 1;
  if (hasText(draft.start_date) && hasText(draft.end_date)) {
    return draft.start_date !== draft.end_date;
  }
  if (hasText(draft.hotel_search?.check_in) && hasText(draft.hotel_search?.check_out)) {
    return draft.hotel_search.check_in !== draft.hotel_search.check_out;
  }
  return undefined;
}

function hasSelectedHotel(context, draft) {
  return isRecord(context.selected_hotel)
    || isRecord(draft.selected_hotel)
    || hasAnswer(context.answers, "hotel_selection")
    || hasAnswer(context.answers, "selected_hotel");
}

function groundedHotelOptions(question) {
  if (!question || !Array.isArray(question.options) || question.options.length < 1) return false;
  return question.options.every((option) => isRecord(option)
    && hasText(option.value)
    && hasText(option.label)
    && (hasText(option.place_id) || hasText(option.maps_url)));
}

function hasAnswer(answers, key) {
  return isRecord(answers) && Object.hasOwn(answers, key);
}

function normalizeMode(value) {
  if (value === "GENERAL") return "GENERAL_TRAVEL";
  if (value === "HOTEL_SEARCH") return "PLACES_SEARCH";
  return MODE_SET.has(value) ? value : "UNKNOWN";
}

function firstKnownMode(...values) {
  for (const value of values) {
    const mode = normalizeMode(value);
    if (mode !== "UNKNOWN") return mode;
  }
  return "UNKNOWN";
}

function recordKeys(value) {
  return isRecord(value) ? Object.keys(value).filter((key) => hasText(key)) : [];
}

function stringArray(value, maximum) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(hasText).map((item) => item.trim()))].slice(-maximum);
}

function optionalBoolean(value) {
  return typeof value === "boolean" ? value : undefined;
}

function booleanOr(...values) {
  return values.find((value) => typeof value === "boolean");
}

function boundedText(value, maximum) {
  return hasText(value) ? value.trim().slice(0, maximum) : undefined;
}

function boundedInteger(value, minimum, maximum) {
  return Number.isInteger(value) ? Math.min(maximum, Math.max(minimum, value)) : minimum;
}

function hasText(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function violation(code, message) {
  return { code, message };
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
