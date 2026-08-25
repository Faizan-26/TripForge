import { defineTool } from "@deepseek-ai/dsh-tools";

const DEFAULT_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const DEFAULT_MAX_RESULTS = 8;
const DEFAULT_TIMEOUT_MS = 15_000;
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.googleMapsUri",
  "places.primaryType",
  "places.types",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
  "places.currentOpeningHours.openNow",
].join(",");

export const name = "tripforge-google-places";
export const inject = ["tools", "systemPrompt"];

export function apply(ctx, config = {}) {
  const apiKeyEnv = config.apiKeyEnv ?? "GOOGLE_MAPS_API_KEY";
  const apiKey = process.env[apiKeyEnv];
  if (!apiKey) {
    throw new Error(`tripforge-google-places: ${apiKeyEnv} is required`);
  }

  const maxResults = positiveInteger(config.maxResults, DEFAULT_MAX_RESULTS, 1, 10);
  const timeoutMs = positiveInteger(config.timeoutMs, DEFAULT_TIMEOUT_MS, 1, 60_000);
  ctx.systemPrompt.section({
    name: "tool:search_google_places",
    order: 105,
    text: [
      "Use search_google_places for current hotels, stays, attractions, restaurants,",
      "and destination anchors. Treat every returned place_id as the authoritative",
      "identity. Never invent places, ratings, addresses, coordinates, or Maps links.",
      "Search calls are read-only and may run concurrently when independent.",
    ].join(" "),
  });
  ctx.tools.register(createGooglePlacesSearchTool({ apiKey, maxResults, timeoutMs }));
}

export function createGooglePlacesSearchTool({
  apiKey,
  fetchImpl = globalThis.fetch,
  endpoint = DEFAULT_ENDPOINT,
  maxResults = DEFAULT_MAX_RESULTS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    throw new Error("search_google_places requires a Google Maps API key");
  }
  assertProviderEndpoint(endpoint);
  if (typeof fetchImpl !== "function") throw new Error("fetchImpl must be a function");
  const resultLimit = positiveInteger(maxResults, DEFAULT_MAX_RESULTS, 1, 10);
  const callTimeout = positiveInteger(timeoutMs, DEFAULT_TIMEOUT_MS, 1, 60_000);

  return defineTool({
    name: "search_google_places",
    description:
      "Search Google Places for real hotels, stays, attractions, restaurants, or destination anchors. " +
      "Returns stable Google place IDs and grounded place details.",
    parameters: {
      query: {
        type: "string",
        required: true,
        description: "A specific place-search query, for example 'boutique hotels in Kyoto'.",
      },
      max_results: {
        type: "integer",
        description: `Requested result count from 1 to ${resultLimit}.`,
      },
      location_bias: {
        type: "object",
        additionalProperties: false,
        description: "Optional circular search bias when reliable coordinates are already known.",
        properties: {
          latitude: { type: "number", required: true },
          longitude: { type: "number", required: true },
          radius_meters: { type: "number", required: true },
        },
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", required: true },
          places: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                place_id: { type: "string", required: true },
                name: { type: "string", required: true },
                formatted_address: { type: "string" },
                latitude: { type: "number" },
                longitude: { type: "number" },
                google_maps_uri: { type: "string" },
                primary_type: { type: "string" },
                types: { type: "array", items: { type: "string" }, required: true },
                rating: { type: "number" },
                user_rating_count: { type: "integer" },
                price_level: { type: "string" },
                open_now: { type: "boolean" },
              },
            },
          },
        },
      },
      render: (args, value) => [{ type: "text", text: renderForModel(args.query, value.places) }],
      presentationMeta: (args, value) => ({
        query: args.query,
        count: value.places.length,
        places: value.places.map((place) => ({
          place_id: place.place_id,
          name: place.name,
          ...(place.google_maps_uri ? { google_maps_uri: place.google_maps_uri } : {}),
        })),
      }),
    },
    timeoutMs: callTimeout,
    isConcurrencySafe: () => true,
    presentCall: (args) => ({
      card: "generic",
      title: "Searching Google Places",
      kind: "search",
      rawInput: args.query,
    }),
    presentResult: (args, result) => {
      if (result.isError) return undefined;
      const count = Number(result.meta?.count);
      return {
        card: "generic",
        title: Number.isInteger(count)
          ? `Found ${count} Google Places result${count === 1 ? "" : "s"}`
          : `Google Places search: ${args.query}`,
      };
    },
    async execute(args, exec) {
      const request = buildSearchRequest(args, resultLimit);
      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          redirect: "error",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": apiKey,
            "x-goog-fieldmask": FIELD_MASK,
          },
          body: JSON.stringify(request),
          signal: exec.signal,
        });
      } catch (error) {
        if (exec.signal.aborted || error?.name === "AbortError") {
          throw new Error("Google Places search was cancelled", { cause: error });
        }
        throw new Error("Google Places request failed", { cause: error });
      }
      if (!response.ok) throw await providerError(response);
      const payload = await response.json();
      const places = Array.isArray(payload?.places)
        ? payload.places.slice(0, request.maxResultCount).flatMap(normalizePlace)
        : [];
      return { query: args.query.trim(), places };
    },
  });
}

function buildSearchRequest(args, maxResults) {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query || query.length > 300) {
    throw new Error("query must contain between 1 and 300 characters");
  }
  const maxResultCount = positiveInteger(args.max_results, maxResults, 1, maxResults);
  const request = { textQuery: query, maxResultCount, languageCode: "en" };
  if (args.location_bias !== undefined) {
    const { latitude, longitude, radius_meters: radius } = args.location_bias;
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      throw new Error("location_bias.latitude must be between -90 and 90");
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new Error("location_bias.longitude must be between -180 and 180");
    }
    if (!Number.isFinite(radius) || radius < 1 || radius > 50_000) {
      throw new Error("location_bias.radius_meters must be between 1 and 50000");
    }
    request.locationBias = {
      circle: { center: { latitude, longitude }, radius },
    };
  }
  return request;
}

function normalizePlace(value) {
  if (!value || typeof value !== "object") return [];
  const placeId = boundedString(value.id, 300);
  const placeName = typeof value.displayName?.text === "string"
    ? boundedString(value.displayName.text, 200)
    : "";
  if (!placeId || !placeName) return [];
  const latitude = finiteNumber(value.location?.latitude);
  const longitude = finiteNumber(value.location?.longitude);
  const rating = finiteNumber(value.rating);
  return [{
    place_id: placeId,
    name: placeName,
    ...(boundedString(value.formattedAddress, 500)
      ? { formatted_address: boundedString(value.formattedAddress, 500) }
      : {}),
    ...(latitude !== undefined && latitude >= -90 && latitude <= 90 ? { latitude } : {}),
    ...(longitude !== undefined && longitude >= -180 && longitude <= 180 ? { longitude } : {}),
    ...(safeMapsUrl(value.googleMapsUri) ? { google_maps_uri: value.googleMapsUri } : {}),
    ...(boundedString(value.primaryType, 80)
      ? { primary_type: boundedString(value.primaryType, 80) }
      : {}),
    types: Array.isArray(value.types)
      ? value.types.flatMap((item) => boundedString(item, 80) || []).slice(0, 20)
      : [],
    ...(rating !== undefined && rating >= 0 && rating <= 5 ? { rating } : {}),
    ...(Number.isInteger(value.userRatingCount) && value.userRatingCount >= 0
      ? { user_rating_count: value.userRatingCount }
      : {}),
    ...(boundedString(value.priceLevel, 80)
      ? { price_level: boundedString(value.priceLevel, 80) }
      : {}),
    ...(typeof value.currentOpeningHours?.openNow === "boolean"
      ? { open_now: value.currentOpeningHours.openNow }
      : {}),
  }];
}

function renderForModel(query, places) {
  if (places.length === 0) return `Google Places returned no results for: ${query}`;
  const rows = places.map((place, index) => {
    const details = [
      place.formatted_address,
      place.rating !== undefined
        ? `rating ${place.rating}${place.user_rating_count ? ` (${place.user_rating_count} reviews)` : ""}`
        : undefined,
      `place_id ${place.place_id}`,
      place.google_maps_uri,
    ].filter(Boolean);
    return `${index + 1}. ${place.name} — ${details.join("; ")}`;
  });
  return `Grounded Google Places results for "${query}":\n${rows.join("\n")}`;
}

async function providerError(response) {
  let detail = "";
  try {
    const payload = await response.json();
    if (typeof payload?.error?.message === "string") detail = payload.error.message.slice(0, 300);
  } catch {
    // The status code remains enough for a safe provider error.
  }
  return new Error(
    `Google Places returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
  );
}

function assertProviderEndpoint(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("Google Places endpoint must be a valid URL");
  }
  if (url.protocol !== "https:" || url.hostname !== "places.googleapis.com") {
    throw new Error("Google Places endpoint must use https://places.googleapis.com");
  }
}

function positiveInteger(value, fallback, minimum, maximum) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`expected an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function boundedString(value, maximum) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function safeMapsUrl(value) {
  if (typeof value !== "string" || value.length > 2000) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (
      url.hostname === "maps.google.com"
      || url.hostname === "www.google.com"
      || url.hostname.endsWith(".google.com")
    );
  } catch {
    return false;
  }
}
