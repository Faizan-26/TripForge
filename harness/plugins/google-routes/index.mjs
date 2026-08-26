import { defineTool } from "@deepseek-ai/dsh-tools";

const DEFAULT_ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes";
const DEFAULT_MAX_STOPS = 10;
const DEFAULT_TIMEOUT_MS = 20_000;
const FIELD_MASK = [
  "routes.distanceMeters",
  "routes.duration",
  "routes.polyline.encodedPolyline",
  "routes.optimizedIntermediateWaypointIndex",
  "routes.legs.distanceMeters",
  "routes.legs.duration",
].join(",");
const MODES = new Set(["DRIVE", "WALK", "BICYCLE", "TRANSIT"]);

export const name = "tripforge-google-routes";
export const inject = ["tools", "systemPrompt"];

export function apply(ctx, config = {}) {
  const apiKeyEnv = config.apiKeyEnv ?? "GOOGLE_MAPS_API_KEY";
  const apiKey = process.env[apiKeyEnv];
  if (!apiKey) throw new Error(`tripforge-google-routes: ${apiKeyEnv} is required`);
  const maxStops = positiveInteger(config.maxStops, DEFAULT_MAX_STOPS, 1, 25);
  const timeoutMs = positiveInteger(config.timeoutMs, DEFAULT_TIMEOUT_MS, 1, 60_000);
  ctx.systemPrompt.section({
    name: "tool:compute_google_route",
    order: 106,
    text: [
      "Use compute_google_route only after places have stable provider IDs or coordinates.",
      "It deterministically calculates distance, duration, leg order, and route geometry.",
      "Use route output for geographic compatibility and itinerary timing; never estimate",
      "road distance or travel time when this tool returns a grounded value.",
    ].join(" "),
  });
  ctx.tools.register(createGoogleRouteTool({ apiKey, maxStops, timeoutMs }));
}

export function createGoogleRouteTool({
  apiKey,
  fetchImpl = globalThis.fetch,
  endpoint = DEFAULT_ENDPOINT,
  maxStops = DEFAULT_MAX_STOPS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    throw new Error("compute_google_route requires a Google Maps API key");
  }
  assertProviderEndpoint(endpoint);
  if (typeof fetchImpl !== "function") throw new Error("fetchImpl must be a function");
  const stopLimit = positiveInteger(maxStops, DEFAULT_MAX_STOPS, 1, 25);
  const callTimeout = positiveInteger(timeoutMs, DEFAULT_TIMEOUT_MS, 1, 60_000);

  return defineTool({
    name: "compute_google_route",
    description:
      "Compute a grounded Google Routes round trip from one origin through ordered or optimized stops. " +
      "Returns road distance, travel duration, legs, route order, encoded polyline, and a Google Maps URL.",
    parameters: {
      origin: locationParameter("Round-trip origin, normally the selected stay.", true),
      stops: {
        type: "array",
        required: true,
        items: locationParameter("A grounded route stop.", false),
        description: `One to ${stopLimit} grounded route stops.`,
      },
      travel_mode: {
        type: "string",
        enum: ["DRIVE", "WALK", "BICYCLE", "TRANSIT"],
        required: true,
        description: "Google Routes travel mode.",
      },
      optimize_stop_order: {
        type: "boolean",
        description: "Optimize stop order for DRIVE. Defaults to true when multiple stops exist.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          origin: outputLocationSchema(true),
          ordered_stops: { type: "array", required: true, items: outputLocationSchema(false) },
          travel_mode: { type: "string", required: true },
          distance_meters: { type: "integer" },
          duration_seconds: { type: "integer" },
          encoded_polyline: { type: "string" },
          google_maps_url: { type: "string", required: true },
          legs: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                from_label: { type: "string", required: true },
                to_label: { type: "string", required: true },
                distance_meters: { type: "integer" },
                duration_seconds: { type: "integer" },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: "text", text: renderForModel(value) }],
      presentationMeta: (_args, value) => ({
        distance_meters: value.distance_meters,
        duration_seconds: value.duration_seconds,
        stop_count: value.ordered_stops.length,
        google_maps_url: value.google_maps_url,
      }),
    },
    timeoutMs: callTimeout,
    isConcurrencySafe: () => true,
    presentCall: (args) => ({
      card: "generic",
      title: `Computing route from ${args.origin.label}`,
      kind: "fetch",
      rawInput: {
        travel_mode: args.travel_mode,
        stops: args.stops.map((stop) => stop.label),
      },
    }),
    presentResult: (_args, result) => {
      if (result.isError) return undefined;
      const distance = finiteNumber(result.meta?.distance_meters);
      const duration = finiteNumber(result.meta?.duration_seconds);
      return {
        card: "generic",
        title: distance === undefined || duration === undefined
          ? "Google route computed"
          : `${(distance / 1000).toFixed(1)} km · ${Math.round(duration / 60)} min`,
      };
    },
    async execute(args, exec) {
      const request = buildRouteRequest(args, stopLimit);
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
          body: JSON.stringify(request.body),
          signal: exec.signal,
        });
      } catch (error) {
        if (exec.signal.aborted || error?.name === "AbortError") {
          throw new Error("Google Routes request was cancelled", { cause: error });
        }
        throw new Error("Google Routes request failed", { cause: error });
      }
      if (!response.ok) throw await providerError(response);
      const payload = await response.json();
      const route = Array.isArray(payload?.routes) ? payload.routes[0] : undefined;
      if (!route || typeof route !== "object") throw new Error("Google Routes returned no route");
      return normalizeRoute(route, request);
    },
  });
}

function locationParameter(description, required) {
  return {
    type: "object",
    ...(required ? { required: true } : {}),
    additionalProperties: false,
    description,
    properties: {
      label: { type: "string", required: true },
      place_id: { type: "string" },
      latitude: { type: "number" },
      longitude: { type: "number" },
    },
  };
}

function outputLocationSchema(required) {
  return {
    type: "object",
    ...(required ? { required: true } : {}),
    additionalProperties: false,
    properties: {
      label: { type: "string", required: true },
      place_id: { type: "string" },
      latitude: { type: "number" },
      longitude: { type: "number" },
    },
  };
}

function buildRouteRequest(args, maxStops) {
  if (!MODES.has(args.travel_mode)) throw new Error("travel_mode is unsupported");
  if (!Array.isArray(args.stops) || args.stops.length < 1 || args.stops.length > maxStops) {
    throw new Error(`stops must contain between 1 and ${maxStops} locations`);
  }
  if (args.travel_mode === "TRANSIT" && args.stops.length > 1) {
    throw new Error("TRANSIT routes support one stop in the current TripForge adapter");
  }
  const origin = normalizeLocation(args.origin, "origin");
  const stops = args.stops.map((stop, index) => normalizeLocation(stop, `stops[${index}]`));
  const optimize = args.travel_mode === "DRIVE"
    && stops.length > 1
    && args.optimize_stop_order !== false;
  return {
    origin,
    stops,
    travelMode: args.travel_mode,
    optimize,
    body: {
      origin: waypoint(origin),
      destination: waypoint(origin),
      intermediates: stops.map(waypoint),
      travelMode: args.travel_mode,
      computeAlternativeRoutes: false,
      languageCode: "en-US",
      units: "METRIC",
      optimizeWaypointOrder: optimize,
    },
  };
}

function normalizeLocation(value, field) {
  if (!value || typeof value !== "object") throw new Error(`${field} must be a location`);
  const label = boundedString(value.label, 200);
  const placeId = boundedString(value.place_id, 300);
  const latitude = finiteNumber(value.latitude);
  const longitude = finiteNumber(value.longitude);
  if (!label) throw new Error(`${field}.label is required`);
  if (!placeId && (latitude === undefined || longitude === undefined)) {
    throw new Error(`${field} requires place_id or latitude and longitude`);
  }
  if (latitude !== undefined && (latitude < -90 || latitude > 90)) {
    throw new Error(`${field}.latitude must be between -90 and 90`);
  }
  if (longitude !== undefined && (longitude < -180 || longitude > 180)) {
    throw new Error(`${field}.longitude must be between -180 and 180`);
  }
  return {
    label,
    ...(placeId ? { place_id: placeId } : {}),
    ...(latitude !== undefined ? { latitude } : {}),
    ...(longitude !== undefined ? { longitude } : {}),
  };
}

function waypoint(location) {
  if (location.place_id) return { placeId: location.place_id };
  return { location: { latLng: { latitude: location.latitude, longitude: location.longitude } } };
}

function normalizeRoute(route, request) {
  const order = validOrder(route.optimizedIntermediateWaypointIndex, request.stops.length)
    ? route.optimizedIntermediateWaypointIndex
    : request.stops.map((_, index) => index);
  const orderedStops = order.map((index) => request.stops[index]);
  const points = [request.origin, ...orderedStops, request.origin];
  const rawLegs = Array.isArray(route.legs) ? route.legs : [];
  const legs = rawLegs.slice(0, points.length - 1).map((leg, index) => ({
    from_label: points[index].label,
    to_label: points[index + 1].label,
    ...(nonNegativeInteger(leg?.distanceMeters) !== undefined
      ? { distance_meters: leg.distanceMeters }
      : {}),
    ...(durationSeconds(leg?.duration) !== undefined
      ? { duration_seconds: durationSeconds(leg.duration) }
      : {}),
  }));
  const distance = nonNegativeInteger(route.distanceMeters);
  const duration = durationSeconds(route.duration);
  const polyline = boundedString(route.polyline?.encodedPolyline, 50_000);
  return {
    origin: request.origin,
    ordered_stops: orderedStops,
    travel_mode: request.travelMode,
    ...(distance !== undefined ? { distance_meters: distance } : {}),
    ...(duration !== undefined ? { duration_seconds: duration } : {}),
    ...(polyline ? { encoded_polyline: polyline } : {}),
    google_maps_url: directionsUrl(request.origin, orderedStops, request.travelMode),
    legs,
  };
}

function validOrder(value, count) {
  return Array.isArray(value)
    && value.length === count
    && new Set(value).size === count
    && value.every((index) => Number.isInteger(index) && index >= 0 && index < count);
}

function directionsUrl(origin, stops, mode) {
  const query = (location) => location.latitude !== undefined && location.longitude !== undefined
    ? `${location.latitude},${location.longitude}`
    : location.label;
  const params = new URLSearchParams({
    api: "1",
    origin: query(origin),
    destination: query(origin),
    travelmode: { DRIVE: "driving", WALK: "walking", BICYCLE: "bicycling", TRANSIT: "transit" }[mode],
  });
  params.set("waypoints", stops.map(query).join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function renderForModel(route) {
  const summary = [
    route.distance_meters !== undefined ? `${(route.distance_meters / 1000).toFixed(1)} km` : undefined,
    route.duration_seconds !== undefined ? `${Math.round(route.duration_seconds / 60)} minutes` : undefined,
  ].filter(Boolean).join(", ") || "distance and duration unavailable";
  const legs = route.legs.map((leg, index) => {
    const detail = [
      leg.distance_meters !== undefined ? `${(leg.distance_meters / 1000).toFixed(1)} km` : undefined,
      leg.duration_seconds !== undefined ? `${Math.round(leg.duration_seconds / 60)} min` : undefined,
    ].filter(Boolean).join(", ");
    return `${index + 1}. ${leg.from_label} → ${leg.to_label}${detail ? ` (${detail})` : ""}`;
  });
  return [
    `Grounded Google route: ${summary}.`,
    `Stop order: ${route.ordered_stops.map((stop) => stop.label).join(" → ")}.`,
    ...legs,
    `Google Maps: ${route.google_maps_url}`,
  ].join("\n");
}

async function providerError(response) {
  let detail = "";
  try {
    const payload = await response.json();
    if (typeof payload?.error?.message === "string") detail = payload.error.message.slice(0, 300);
  } catch {
    // Status remains enough for a safe error.
  }
  return new Error(`Google Routes returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
}

function assertProviderEndpoint(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("Google Routes endpoint must be a valid URL");
  }
  if (url.protocol !== "https:" || url.hostname !== "routes.googleapis.com") {
    throw new Error("Google Routes endpoint must use https://routes.googleapis.com");
  }
}

function positiveInteger(value, fallback, minimum, maximum) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`expected an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function durationSeconds(value) {
  if (typeof value !== "string" || !value.endsWith("s")) return undefined;
  const parsed = Number(value.slice(0, -1));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : undefined;
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function boundedString(value, maximum) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}
