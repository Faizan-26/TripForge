import test from "node:test";
import assert from "node:assert/strict";

import {
  apply,
  createGooglePlacesSearchTool,
} from "../plugins/google-places/index.mjs";

function execution() {
  return { signal: new AbortController().signal };
}

test("Google Places Cordis plugin registers one typed tool and prompt section", () => {
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
  assert.equal(registered.name, "search_google_places");
  assert.equal(registered.isConcurrencySafe({ query: "hotels in Kyoto" }), true);
  assert.equal(section.name, "tool:search_google_places");
});

test("Google Places plugin sends a bounded request and normalizes provider identity", async () => {
  let request;
  const tool = createGooglePlacesSearchTool({
    apiKey: "test-key",
    maxResults: 5,
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({
        places: [{
          id: "ChIJ-tripforge",
          displayName: { text: "TripForge Hotel" },
          formattedAddress: "1 Example Road, Kyoto",
          location: { latitude: 35.01, longitude: 135.76 },
          googleMapsUri: "https://maps.google.com/?cid=tripforge",
          primaryType: "hotel",
          types: ["hotel", "lodging"],
          rating: 4.7,
          userRatingCount: 321,
          currentOpeningHours: { openNow: true },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const result = await tool.execute({
    query: "boutique hotels in Kyoto",
    max_results: 3,
    location_bias: { latitude: 35, longitude: 135.7, radius_meters: 5000 },
  }, execution());

  assert.equal(request.url, "https://places.googleapis.com/v1/places:searchText");
  assert.equal(request.options.headers["x-goog-api-key"], "test-key");
  assert.equal(request.body.maxResultCount, 3);
  assert.equal(request.body.locationBias.circle.radius, 5000);
  assert.deepEqual(result.places[0], {
    place_id: "ChIJ-tripforge",
    name: "TripForge Hotel",
    formatted_address: "1 Example Road, Kyoto",
    latitude: 35.01,
    longitude: 135.76,
    google_maps_uri: "https://maps.google.com/?cid=tripforge",
    primary_type: "hotel",
    types: ["hotel", "lodging"],
    rating: 4.7,
    user_rating_count: 321,
    open_now: true,
  });
});

test("Google Places plugin rejects unsafe endpoints and invalid location bias", async () => {
  assert.throws(
    () => createGooglePlacesSearchTool({ apiKey: "test", endpoint: "http://localhost/places" }),
    /places.googleapis.com/,
  );
  const tool = createGooglePlacesSearchTool({
    apiKey: "test",
    fetchImpl: async () => assert.fail("invalid arguments must not reach the provider"),
  });
  await assert.rejects(
    tool.execute({
      query: "hotels",
      location_bias: { latitude: 100, longitude: 0, radius_meters: 1000 },
    }, execution()),
    /latitude/,
  );
});

test("Google Places plugin returns a sanitized provider failure", async () => {
  const tool = createGooglePlacesSearchTool({
    apiKey: "test",
    fetchImpl: async () => new Response(JSON.stringify({
      error: { message: "API key rejected" },
    }), { status: 403, headers: { "content-type": "application/json" } }),
  });
  await assert.rejects(
    tool.execute({ query: "hotels in Kyoto" }, execution()),
    /HTTP 403: API key rejected/,
  );
});
