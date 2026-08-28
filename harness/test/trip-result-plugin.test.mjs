import test from "node:test";
import assert from "node:assert/strict";

import {
  apply,
  consumeTerminalResponse,
  createTripResultTool,
  validateTerminalResponse,
} from "../plugins/trip-result/index.mjs";
import { rememberSessionPlaces } from "../plugins/shared/session-places.mjs";

test("Trip result plugin registers one terminal tool and prompt section", () => {
  let registered;
  let section;
  apply({
    tools: { register: (definition) => { registered = definition; } },
    systemPrompt: { section: (definition) => { section = definition; } },
  });
  assert.equal(registered.name, "submit_trip_response");
  assert.equal(registered.parameters.properties.response.required, undefined);
  assert.deepEqual(
    registered.parameters.properties.outcome.enum,
    ["clarification", "general"],
  );
  assert.equal(section.name, "tool:submit_trip_response");
  assert.match(section.text, /ends the turn/iu);
});

test("Trip result is retained until the persisted headless turn flushes", async () => {
  let concluded = false;
  await createTripResultTool().execute(
    { outcome: "general", message: "Ready" },
    {
      agent: { session: { id: "session-persistent" } },
      concludeTurn: () => { concluded = true; },
    },
  );

  assert.equal(concluded, true);
  assert.equal(
    consumeTerminalResponse("session-persistent"),
    '{"outcome":"general","message":"Ready"}',
  );
  assert.equal(consumeTerminalResponse("session-persistent"), undefined);
});

test("hotel selection options are enriched from grounded tool data", async () => {
  rememberSessionPlaces("session-hotel-cards", [{
    place_id: "place-1",
    name: "Canal View Hotel",
    formatted_address: "Gulberg, Lahore",
    rating: 4.6,
    user_rating_count: 812,
    google_maps_uri: "https://maps.google.com/?cid=place-1",
    photo: { name: "places/place-1/photos/photo-1" },
  }]);
  const returned = await createTripResultTool().execute(
    {
      outcome: "clarification",
      questions: [{
        id: "hotel_selection",
        kind: "single_select",
        prompt: "Choose your stay",
        options: [{ value: "place-1", label: "Canal View Hotel" }],
      }],
    },
    {
      agent: { session: { id: "session-hotel-cards" } },
      concludeTurn() {},
    },
  );
  const response = JSON.parse(consumeTerminalResponse("session-hotel-cards"));
  assert.deepEqual(returned, response);
  assert.deepEqual(response.questions[0].options[0], {
    value: "place-1",
    label: "Canal View Hotel",
    place_id: "place-1",
    address: "Gulberg, Lahore",
    rating: 4.6,
    review_count: 812,
    maps_url: "https://maps.google.com/?cid=place-1",
    photo_name: "places/place-1/photos/photo-1",
    image_alt: "Canal View Hotel hotel photo",
  });
  assert.equal(hasUndefined(returned), false);
});

test("Trip result terminal envelope accepts supported outcomes and rejects incomplete data", () => {
  assert.deepEqual(validateTerminalResponse({
    outcome: "general",
    message: "A concise response",
  }), {
    outcome: "general",
    message: "A concise response",
  });
  assert.deepEqual(validateTerminalResponse({
    outcome: "clarification",
    questions: [{ id: "dates" }],
  }), {
    outcome: "clarification",
    questions: [{ id: "dates" }],
  });
  assert.throws(() => validateTerminalResponse({ outcome: "general" }), /requires a message/u);
  assert.throws(() => validateTerminalResponse({ outcome: "clarification", questions: [] }), /requires questions/u);
  assert.throws(() => validateTerminalResponse({ outcome: "plan" }), /unsupported outcome/u);
  assert.equal(createTripResultTool().name, "submit_trip_response");
});

function hasUndefined(value) {
  if (value === undefined) return true;
  if (Array.isArray(value)) return value.some(hasUndefined);
  if (value && typeof value === "object") return Object.values(value).some(hasUndefined);
  return false;
}
