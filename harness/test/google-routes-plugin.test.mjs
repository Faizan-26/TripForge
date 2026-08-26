import test from "node:test";
import assert from "node:assert/strict";

import { apply, createGoogleRouteTool } from "../plugins/google-routes/index.mjs";

function execution() {
  return { signal: new AbortController().signal };
}

test("Google Routes Cordis plugin registers one typed read-only tool", () => {
  const previous = process.env.GOOGLE_MAPS_API_KEY;
  process.env.GOOGLE_MAPS_API_KEY = "test-key";
  let registered;
  let section;
  try {
    apply({
      tools: { register: (definition) => { registered = definition; } },
      systemPrompt: { section: (definition) => { section = definition; } },
    });
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = previous;
  }
  assert.equal(registered.name, "compute_google_route");
  assert.equal(registered.isConcurrencySafe({
    origin: { label: "Hotel", place_id: "hotel-1" },
    stops: [{ label: "Museum", place_id: "museum-1" }],
    travel_mode: "DRIVE",
  }), true);
  assert.equal(section.name, "tool:compute_google_route");
});

test("Google Routes plugin optimizes a round trip and normalizes legs", async () => {
  let request;
  const tool = createGoogleRouteTool({
    apiKey: "test-key",
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({ routes: [{
        distanceMeters: 9000,
        duration: "1800s",
        polyline: { encodedPolyline: "encoded-route" },
        optimizedIntermediateWaypointIndex: [1, 0],
        legs: [
          { distanceMeters: 3000, duration: "600s" },
          { distanceMeters: 2500, duration: "500s" },
          { distanceMeters: 3500, duration: "700s" },
        ],
      }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const result = await tool.execute({
    origin: { label: "Hotel", place_id: "hotel-1" },
    stops: [
      { label: "Museum", place_id: "museum-1" },
      { label: "Park", place_id: "park-1" },
    ],
    travel_mode: "DRIVE",
  }, execution());

  assert.equal(request.url, "https://routes.googleapis.com/directions/v2:computeRoutes");
  assert.equal(request.options.headers["x-goog-api-key"], "test-key");
  assert.deepEqual(request.body.origin, { placeId: "hotel-1" });
  assert.equal(request.body.optimizeWaypointOrder, true);
  assert.deepEqual(result.ordered_stops.map((stop) => stop.place_id), ["park-1", "museum-1"]);
  assert.equal(result.distance_meters, 9000);
  assert.equal(result.duration_seconds, 1800);
  assert.deepEqual(result.legs.map((leg) => [leg.from_label, leg.to_label]), [
    ["Hotel", "Park"],
    ["Park", "Museum"],
    ["Museum", "Hotel"],
  ]);
  assert.match(result.google_maps_url, /^https:\/\/www\.google\.com\/maps\/dir\//u);
});

test("Google Routes plugin rejects ungrounded locations and unsupported transit trips", async () => {
  const tool = createGoogleRouteTool({
    apiKey: "test-key",
    fetchImpl: async () => assert.fail("invalid routes must not reach Google"),
  });
  await assert.rejects(
    tool.execute({
      origin: { label: "Unknown hotel" },
      stops: [{ label: "Museum", place_id: "museum-1" }],
      travel_mode: "DRIVE",
    }, execution()),
    /place_id or latitude/,
  );
  await assert.rejects(
    tool.execute({
      origin: { label: "Hotel", place_id: "hotel-1" },
      stops: [
        { label: "Museum", place_id: "museum-1" },
        { label: "Park", place_id: "park-1" },
      ],
      travel_mode: "TRANSIT",
    }, execution()),
    /support one stop/,
  );
});
