const tripWords = /\b(?:trip|tour|travel|vacation|holiday|itinerary|visit|planning)\b/iu;
const hotelWords = /\b(?:hotel|hotels|stay|stays|accommodation|lodging|resort|hostel)\b/iu;

const option = (value, label, description) => ({
  value,
  label,
  ...(description ? { description } : {}),
});

export function buildFastIntake(request) {
  const payload = isRecord(request.payload) ? request.payload : {};
  const answers = isRecord(payload.answers) ? payload.answers : {};
  if (request.parent_run_id || payload.parent_run_id || Object.keys(answers).length > 0) return undefined;

  const message = String(request.message ?? "").trim();
  const hotelIntent = hotelWords.test(message);
  if (!hotelIntent && !tripWords.test(message)) return undefined;

  const draft = isRecord(payload.draft) ? payload.draft : {};
  const destination = textValue(draft.destination)
    ?? textValue(draft.hotel_search?.destination_query)
    ?? extractDestination(message);
  const origin = textValue(draft.origin)
    ?? textValue(payload.origin?.label)
    ?? textValue(payload.origin?.address)
    ?? extractOrigin(message);
  const detected = detectFacts(message);
  const facts = {
    ...detected,
    hasDates: detected.hasDates
      || Boolean(draft.start_date && draft.end_date)
      || Number.isFinite(draft.duration_days),
    hasTravelers: detected.hasTravelers
      || Number.isFinite(draft.travelers),
    hasBudget: detected.hasBudget
      || Number.isFinite(draft.budget_total),
    hasInterests: detected.hasInterests
      || (Array.isArray(draft.interests) && draft.interests.length > 0),
    hasPace: detected.hasPace || typeof draft.pace === "string",
  };
  const questions = hotelIntent
    ? hotelQuestions({ destination, ...facts })
    : tripQuestions({ destination, origin, ...facts });
  if (questions.length === 0) return undefined;

  const subject = destination ?? (hotelIntent ? "Hotel" : "Trip");
  return {
    draft: {
      intent: hotelIntent ? "HOTEL_SEARCH" : "FULL_TRIP_PLAN",
      ...(destination ? { destination } : {}),
      ...(origin ? { origin } : {}),
    },
    clarifications: questions.slice(0, 8),
    ui_schema_version: "1",
    conversation_title: `${subject} ${hotelIntent ? "hotel search" : "trip planning"}`,
    harness: { provider: "tripforge-intake", session_id: request.conversation_id },
  };
}

function tripQuestions(facts) {
  return [
    !facts.origin && question("origin", "location", "Where will you be traveling from?", {
      placeholder: "City, region, or airport",
    }),
    !facts.destination && question("destination", "location", "Where would you like to go?", {
      placeholder: "City, region, or country",
    }),
    !facts.hasDates && question("travel_dates", "date_range", "When will your trip start and end?", {
      description: "Choose both dates. You can mention flexible dates in your other preferences.",
    }),
    !facts.hasTravelers && question("traveler_composition", "text", "Who is traveling?", {
      placeholder: "For example: 2 adults and 1 child",
    }),
    !facts.hasBudget && question("budget", "text", "What is your total trip budget and currency?", {
      placeholder: "For example: PKR 150,000 total",
    }),
    !facts.hasInterests && question("interests", "multi_select", "What would you most like to include?", {
      allow_other: true,
      options: [
        option("food", "Local food"), option("history_culture", "History & culture"),
        option("nature", "Nature"), option("shopping", "Shopping"),
        option("adventure", "Adventure"), option("relaxation", "Relaxation"),
      ],
    }),
    !facts.hasPace && question("preferred_pace", "single_select", "What pace do you prefer?", {
      allow_other: false,
      options: [
        option("relaxed", "Relaxed", "Fewer stops and more free time"),
        option("balanced", "Balanced", "A comfortable mix of plans and breaks"),
        option("active", "Active", "More sights and fuller days"),
      ],
    }),
    question("constraints", "textarea", "Any mobility, dietary, or transport preferences?", {
      required: false,
      placeholder: "Optional — for example: vegetarian meals and public transport",
    }),
  ].filter(Boolean);
}

function hotelQuestions(facts) {
  return [
    !facts.destination && question("destination", "location", "Where should I search for a hotel?", {
      placeholder: "City, neighborhood, or landmark",
    }),
    !facts.hasDates && question("stay_dates", "date_range", "What are your check-in and check-out dates?"),
    !facts.hasTravelers && question("guest_composition", "text", "Who will be staying?", {
      placeholder: "For example: 2 adults and 1 child",
    }),
    !facts.hasRooms && question("rooms", "number", "How many rooms do you need?", {
      min_value: 1,
      max_value: 20,
      step: 1,
    }),
    !facts.hasBudget && question("budget", "text", "What is your hotel budget and currency?", {
      placeholder: "For example: USD 150 per night",
    }),
    !facts.hasLodging && question("lodging_style", "single_select", "What kind of stay do you prefer?", {
      allow_other: true,
      options: [
        option("budget", "Budget"), option("mid_range", "Mid-range"),
        option("boutique", "Boutique"), option("luxury", "Luxury"),
        option("apartment", "Apartment"),
      ],
    }),
    question("hotel_must_haves", "multi_select", "Which hotel features matter most?", {
      required: false,
      allow_other: true,
      options: [
        option("central", "Central location"), option("breakfast", "Breakfast"),
        option("parking", "Parking"), option("pool", "Pool"),
        option("kitchen", "Kitchen"), option("workspace", "Workspace"),
        option("family_friendly", "Family-friendly"),
      ],
    }),
  ].filter(Boolean);
}

function question(id, kind, prompt, extras = {}) {
  return {
    id,
    kind,
    prompt,
    required: extras.required !== false,
    options: extras.options ?? [],
    allow_other: extras.allow_other === true,
    ...extras,
  };
}

function detectFacts(message) {
  return {
    hasDates: /\b\d{4}-\d{2}-\d{2}\b|\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b|\b\d+\s*(?:day|days|week|weeks)\b/iu.test(message),
    hasTravelers: /\b\d+\s*(?:adult|adults|child|children|traveler|travelers|guest|guests|people|person)\b|\bsolo\b|\btravel(?:ing|ling)? alone\b/iu.test(message),
    hasRooms: /\b\d+\s*(?:room|rooms)\b/iu.test(message),
    hasBudget: /(?:[$€£¥₹]|\b(?:usd|eur|gbp|pkr|inr|aed|cad|aud)\b|\bbudget\s+(?:is|of|around)?\s*\d)/iu.test(message),
    hasInterests: /\b(?:food|history|culture|museum|nature|shopping|nightlife|adventure|beach|mountain|relax)\w*\b/iu.test(message),
    hasPace: /\b(?:relaxed|balanced|active|packed|slow pace|fast pace)\b/iu.test(message),
    hasLodging: /\b(?:budget|mid-range|mid range|boutique|luxury|apartment|resort|hostel)\b/iu.test(message),
  };
}

function extractOrigin(message) {
  return cleanPlace(
    message.match(/\bfrom\s+([^,.!?]+?)(?=\s+to\s+)/iu)?.[1]
    ?? message.match(/\b(?:i am|i'm|we are|we're|based|starting)\s+in\s+([^,.!?]+?)(?=\s+(?:and|planning|looking|want|for)\b|$)/iu)?.[1],
  );
}

function extractDestination(message) {
  const fromTo = message.match(/\bfrom\s+[^,.!?]+?\s+to\s+([^,.!?]+)/iu)?.[1];
  const destination = fromTo
    ?? message.match(/\b(?:trip|tour|travel|vacation|holiday)\s+(?:in|to)\s+([^,.!?]+)/iu)?.[1]
    ?? message.match(/\b(?:visit|visiting|hotels?|stays?|accommodation)\s+(?:in|near|around)?\s*([^,.!?]+)/iu)?.[1];
  return cleanPlace(destination);
}

function cleanPlace(value) {
  if (!value) return undefined;
  const cleaned = value
    .replace(/\b(?:for|with|on|during|starting)\b[\s\S]*$/iu, "")
    .replace(/\b(?:please|probably|maybe)\b[\s\S]*$/iu, "")
    .trim();
  return cleaned && cleaned.length <= 100 ? titleCase(cleaned) : undefined;
}

function titleCase(value) {
  return value.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

function textValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
