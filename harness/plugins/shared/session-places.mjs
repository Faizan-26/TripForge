const placesBySession = new Map();
const MAX_SESSIONS = 100;
const MAX_PLACES_PER_SESSION = 20;

export function rememberSessionPlaces(sessionId, places) {
  const key = String(sessionId ?? "");
  if (!key || !Array.isArray(places)) return;
  const previous = placesBySession.get(key) ?? new Map();
  for (const place of places) {
    if (!place || typeof place.place_id !== "string") continue;
    previous.set(place.place_id, place);
    if (previous.size > MAX_PLACES_PER_SESSION) {
      previous.delete(previous.keys().next().value);
    }
  }
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
  const places = placesBySession.get(String(sessionId));
  if (!places) return response;
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

export function clearSessionPlaces(sessionId) {
  placesBySession.delete(String(sessionId));
}

function defined(key, value) {
  return value === undefined ? {} : { [key]: value };
}
