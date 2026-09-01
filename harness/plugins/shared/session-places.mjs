const placesBySession = new Map();
const MAX_SESSIONS = 100;
const MAX_PLACES_PER_SESSION = 20;

export function rememberSessionPlaces(sessionId, places) {
  return rememberSessionPlaceSearch(sessionId, undefined, places);
}

export function rememberSessionPlaceSearch(sessionId, searchType, places) {
  const key = String(sessionId ?? "");
  if (!key || !Array.isArray(places)) return;
  const previous = placesBySession.get(key) ?? {
    all: new Map(),
    hotel: new Map(),
    historical_place: new Map(),
    searches: new Set(),
  };
  const typed = searchType === "hotel" || searchType === "historical_place"
    ? previous[searchType]
    : undefined;
  for (const place of places) {
    if (!place || typeof place.place_id !== "string") continue;
    previous.all.set(place.place_id, place);
    typed?.set(place.place_id, place);
    if (previous.all.size > MAX_PLACES_PER_SESSION) {
      previous.all.delete(previous.all.keys().next().value);
    }
    if (typed && typed.size > MAX_PLACES_PER_SESSION) typed.delete(typed.keys().next().value);
  }
  if (typed && places.length > 0) previous.searches.add(searchType);
  placesBySession.delete(key);
  placesBySession.set(key, previous);
  while (placesBySession.size > MAX_SESSIONS) {
    placesBySession.delete(placesBySession.keys().next().value);
  }
}

export function enrichHotelSelection(response, sessionId) {
  if (response?.outcome !== "clarification" || !Array.isArray(response.questions)) {
    return response;
  }
  const stored = placesBySession.get(String(sessionId));
  if (!stored) return response;
  const places = stored.hotel.size > 0 ? stored.hotel : stored.all;
  return {
    ...response,
    questions: response.questions.map((question) => {
      if (question?.id !== "hotel_selection" || !Array.isArray(question.options)) {
        return question;
      }
      return {
        ...question,
        options: question.options.map((option) => {
          const place = places.get(String(option?.value ?? ""));
          if (!place) return option;
          return {
            ...option,
            place_id: place.place_id,
            ...defined("address", place.formatted_address),
            ...defined("rating", place.rating),
            ...defined("review_count", place.user_rating_count),
            ...defined("maps_url", place.google_maps_uri),
            ...defined("price_level", place.price_level),
            ...defined("photo_name", place.photo?.name),
            ...defined(
              "image_alt",
              typeof place.name === "string" ? `${place.name} hotel photo` : undefined,
            ),
            ...defined("image_attribution", place.photo?.author_name),
            ...defined("image_attribution_url", place.photo?.author_uri),
          };
        }),
      };
    }),
  };
}

export function sessionPlaceEvidence(sessionId) {
  const stored = placesBySession.get(String(sessionId));
  return {
    hotel_search_grounded: Boolean(
      stored?.searches.has("hotel") && stored.hotel.size > 0,
    ),
    historical_places_grounded: Boolean(
      stored?.searches.has("historical_place") && stored.historical_place.size > 0,
    ),
  };
}

export function clearSessionPlaces(sessionId) {
  placesBySession.delete(String(sessionId));
}

function defined(key, value) {
  return value === undefined ? {} : { [key]: value };
}
