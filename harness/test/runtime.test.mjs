import test from "node:test";
import assert from "node:assert/strict";

import {
  commandFor,
  DeepSeekCliRuntime,
  FakeRuntime,
  isProviderRateLimitFailure,
  parseHarnessResult,
  parseProgressLine,
  parseResultLine,
  runProcess,
  sessionIdFor,
  ProviderRateLimitError,
} from "../src/runtime.mjs";
import { formatProgressLine, formatResultLine } from "../plugins/progress/index.mjs";
import { renderPluginPatch } from "../src/plugin-patch.mjs";
import { buildFastIntake } from "../src/intake.mjs";
import { createServer, validateExecuteRequest } from "../src/server.mjs";

test("Windows uses the cmd npx shim without a shell", () => {
  const result = commandFor(
    { dshCommand: undefined, dshPackage: "@deepseek-ai/dsh", tripforgePatch: "patch.yml" },
    "win32",
    "Plan a trip",
  );
  assert.equal(result.command, "npx.cmd");
  assert.deepEqual(result.args.slice(0, 4), ["--yes", "@deepseek-ai/dsh", "--profile", "headless"]);
});

test("an explicitly installed CLI takes precedence over npx", () => {
  const result = commandFor(
    { dshCommand: "C:\\tools\\dsh.cmd", tripforgePatch: "patch.yml" },
    "win32",
    "Plan a trip",
  );
  assert.equal(result.command, "C:\\tools\\dsh.cmd");
  assert.deepEqual(result.args.slice(0, 4), ["--profile", "headless", "--patch", "patch.yml"]);
});

test("a pinned JavaScript CLI entrypoint runs through Node without a Windows shell", () => {
  const result = commandFor(
    {
      dshCommand: process.execPath,
      dshPrefixArgs: ["C:\\tripforge\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js"],
      tripforgePatch: "patch.yml",
    },
    "win32",
    "Plan a trip",
  );
  assert.equal(result.command, process.execPath);
  assert.equal(result.args[0], "C:\\tripforge\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js");
  assert.deepEqual(result.args.slice(1, 5), ["--profile", "headless", "--patch", "patch.yml"]);
});

test("custom plugin patch uses literal module URLs instead of evaluated objects", () => {
  const patch = renderPluginPatch({
    progressPlugin: "C:\\tripforge\\plugins\\progress\\index.mjs",
    tripResultPlugin: "C:\\tripforge\\plugins\\trip-result\\index.mjs",
    persistentHeadlessPlugin: "C:\\tripforge\\plugins\\persistent-headless\\index.mjs",
    persistentHeadlessEnabled: true,
    googlePlacesPlugin: "C:\\tripforge\\plugins\\google-places\\index.mjs",
    googleRoutesPlugin: "C:\\tripforge\\plugins\\google-routes\\index.mjs",
    googleMapsEnabled: true,
    googleRoutesEnabled: false,
    supervisorPrompt: "TripForge supervisor {{model}}",
  });
  assert.match(patch, /name: "file:\/\/\/C:\/tripforge\/plugins\/progress\/index\.mjs"/u);
  assert.match(patch, /name: "file:\/\/\/C:\/tripforge\/plugins\/trip-result\/index\.mjs"/u);
  assert.match(patch, /headless-runner[\s\S]*disabled: true/u);
  assert.match(patch, /plugins\/persistent-headless\/index\.mjs/u);
  assert.doesNotMatch(patch, /!!js|DSH_TRIPFORGE/u);
  assert.match(patch, /disabled: false/u);
  assert.match(patch, /tripforge-google-routes[\s\S]*disabled: true/u);
});

test("conversation identity keeps one correlation session id across run ids", () => {
  const conversation = "conversation-1";
  assert.equal(sessionIdFor(conversation), sessionIdFor(conversation));
  assert.notEqual(sessionIdFor(conversation), sessionIdFor("conversation-2"));
});

test("answered or drafted clarification fields are removed from provider output", () => {
  const state = parseHarnessResult(JSON.stringify({
    outcome: "clarification",
    draft: { destination: "Lahore" },
    questions: [
      { id: "destination", prompt: "Where are you going?", kind: "location" },
      { id: "origin", prompt: "Where are you leaving from?", kind: "location" },
      { id: "budget_total", prompt: "What is your budget?", kind: "text" },
    ],
  }), "session-1", {
    answers: { budget: "PKR 100,000" },
    draft: { destination: "Lahore" },
  });

  assert.deepEqual(state.clarifications.map((question) => question.id), ["origin"]);
  assert.equal(state.draft.destination, "Lahore");
});

test("fake runtime emits progress followed by completion", async () => {
  const updates = [];
  for await (const update of new FakeRuntime().execute({})) updates.push(update);
  assert.equal(updates[0].kind, "progress");
  assert.equal(updates.at(-1).kind, "completed");
});

test("execution contract rejects missing identifiers", () => {
  assert.throws(() => validateExecuteRequest({ message: "Plan a trip" }), /run_id/);
});

test("Harness progress frames become public tool events without exposing arbitrary types", () => {
  const event = parseProgressLine(formatProgressLine({
    type: "tool.started",
    agent: "supervisor",
    message: "Google Places search running",
    data: { tool: "search_google_places" },
  }).trimEnd());
  assert.deepEqual(event, {
    type: "tool.started",
    agent: "supervisor",
    message: "Google Places search running",
    data: { tool: "search_google_places" },
  });
  assert.equal(parseProgressLine("ordinary stderr"), undefined);
});

test("terminal result frames carry final output on the private Harness wire", () => {
  const output = '{"outcome":"general","message":"Ready","conversation_title":"Trip"}';
  assert.equal(parseResultLine(formatResultLine(output).trimEnd()), output);
  assert.equal(parseResultLine("ordinary stderr"), undefined);
  assert.equal(parseProgressLine(formatResultLine(output).trimEnd()), undefined);
});

test("a terminal result completes even when the child process keeps running", async () => {
  const output = '{"outcome":"general","message":"Ready","conversation_title":"Trip"}';
  let buffered = "";
  const startedAt = performance.now();
  const result = await runProcess({
    command: process.execPath,
    args: [
      "-e",
      `process.stderr.write(${JSON.stringify(formatResultLine(output))}); setInterval(() => {}, 1000);`,
    ],
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 5_000,
    maxOutputBytes: 1024,
    onStderr(chunk) {
      buffered += chunk;
      const newline = buffered.indexOf("\n");
      if (newline < 0) return undefined;
      return parseResultLine(buffered.slice(0, newline));
    },
  });
  assert.equal(result, output);
  assert.ok(performance.now() - startedAt < 2_000);
});

test("structured clarification output maps to backend state", () => {
  const state = parseHarnessResult(
    '```json\n{"outcome":"clarification","draft":{"destination":"Paris"},"questions":[{"id":"travelers","prompt":"How many travelers?","kind":"number","required":true,"options":[]}]}\n```',
    "session-1",
  );
  assert.equal(state.clarifications[0].kind, "number");
  assert.equal(state.draft.destination, "Paris");
  assert.equal(state.ui_schema_version, "1");
  assert.equal(state.harness.session_id, "session-1");
});

test("structured output is recovered from provider wrapper text", () => {
  const state = parseHarnessResult(
    'Response follows:\n{"outcome":"general","message":"Visit Lahore Fort early.","conversation_title":"Lahore"}\nDone.',
    "session-1",
  );
  assert.equal(state.general_result.message, "Visit Lahore Fort early.");
});

test("structured travel presentations are bounded for frontend rendering", () => {
  const state = parseHarnessResult(JSON.stringify({
    outcome: "general",
    message: "Your compact Lahore plan is ready.",
    conversation_title: "Lahore plan",
    presentation: {
      kind: "trip_plan",
      title: "Three days in Lahore",
      summary: "A relaxed food and heritage route.",
      facts: [{ label: "Budget", value: "PKR 20,000" }],
      sections: [{
        title: "Day 1 — Arrival",
        items: [{
          time: "Evening",
          title: "Gawalmandi Food Street",
          location: "Lahore",
          maps_url: "https://maps.google.com/?cid=food",
        }],
      }],
      notes: ["Confirm hotel rates directly."],
    },
  }), "session-1");
  assert.equal(state.general_result.presentation.kind, "trip_plan");
  assert.equal(state.general_result.presentation.sections[0].items[0].title, "Gawalmandi Food Street");
});

test("hotel clarification retains only safe grounded card metadata", () => {
  const state = parseHarnessResult(JSON.stringify({
    outcome: "clarification",
    questions: [{
      id: "hotel_selection",
      prompt: "Choose a hotel",
      kind: "single_select",
      options: [{
        value: "place-1",
        label: "Canal View Hotel",
        place_id: "place-1",
        address: "Gulberg, Lahore",
        rating: 4.6,
        review_count: 812,
        maps_url: "https://maps.google.com/?cid=place-1",
        photo_name: "places/place-1/photos/photo-1",
        dangerous_html: "<script>alert(1)</script>",
      }],
    }],
  }), "session-1");
  const option = state.clarifications[0].options[0];
  assert.equal(option.photo_name, "places/place-1/photos/photo-1");
  assert.equal(option.rating, 4.6);
  assert.equal("dangerous_html" in option, false);
});

test("combined adult and child questions always use a text control", () => {
  const state = parseHarnessResult(
    JSON.stringify({
      outcome: "clarification",
      questions: [{
        id: "traveler_composition",
        prompt: "How many adults and children are traveling?",
        kind: "number",
        required: true,
        options: [],
        min_value: 1,
      }],
    }),
    "session-1",
  );
  assert.equal(state.clarifications[0].kind, "text");
  assert.equal(state.clarifications[0].placeholder, "For example: 2 adults and 1 child");
  assert.equal("min_value" in state.clarifications[0], false);
});

test("travel date questions normalize to a date-range control", () => {
  const state = parseHarnessResult(
    JSON.stringify({
      outcome: "clarification",
      questions: [{
        id: "travel_dates",
        prompt: "What are your exact travel dates or duration?",
        kind: "date",
        required: true,
        options: [],
      }],
    }),
    "session-1",
  );
  assert.equal(state.clarifications[0].kind, "date_range");
});

test("incomplete trip requests use the fast local intake contract", () => {
  const state = buildFastIntake({
    run_id: "run-1",
    conversation_id: "conversation-1",
    message: "I'm planning a tour to Lahore",
    payload: { answers: {} },
  });
  assert.equal(state.draft.destination, "Lahore");
  assert.equal(state.harness.provider, "tripforge-intake");
  assert.equal(state.clarifications.find((item) => item.id === "travel_dates").kind, "date_range");
  assert.equal(state.clarifications.find((item) => item.id === "traveler_composition").kind, "text");
});

test("fast intake asks only facts missing from the travel scenario", () => {
  const state = buildFastIntake({
    run_id: "run-scenario",
    conversation_id: "conversation-scenario",
    message: "I'm in Sargodha and want a solo trip to Lahore for 3 days with food and a relaxed pace under PKR 20,000",
    payload: { answers: {} },
  });
  const questionIds = state.clarifications.map((item) => item.id);
  assert.equal(state.draft.destination, "Lahore");
  assert.equal(state.draft.origin, "Sargodha");
  assert.deepEqual(questionIds, ["constraints"]);
});

test("DeepSeek runtime completes incomplete intake without launching the provider", async () => {
  const runtime = new DeepSeekCliRuntime({});
  const updates = [];
  for await (const update of runtime.execute({
    run_id: "run-fast",
    conversation_id: "conversation-1",
    message: "Plan a trip to Lahore",
    payload: { answers: {} },
  })) updates.push(update);
  assert.deepEqual(updates.map((item) => item.kind), ["progress", "progress", "completed"]);
  assert.equal(updates.at(-1).state.harness.provider, "tripforge-intake");
});

test("follow-up answers bypass fast intake and continue to the model", () => {
  const state = buildFastIntake({
    run_id: "run-2",
    conversation_id: "conversation-1",
    parent_run_id: "run-1",
    message: "I've added the missing trip details.",
    payload: { answers: { budget: "PKR 150,000" } },
  });
  assert.equal(state, undefined);
});

test("UI schema accepts bounded travel fields and removes unknown presentation data", () => {
  const state = parseHarnessResult(
    JSON.stringify({
      outcome: "clarification",
      questions: [{
        id: "start_date",
        prompt: "When should the trip start?",
        kind: "date",
        required: true,
        options: [],
        description: "Choose your preferred departure date.",
        dangerous_html: "<script>alert(1)</script>",
      }],
    }),
    "session-1",
  );
  assert.equal(state.clarifications[0].description, "Choose your preferred departure date.");
  assert.equal("dangerous_html" in state.clarifications[0], false);
});

test("select questions without choices are rejected", () => {
  assert.throws(
    () => parseHarnessResult(
      '{"outcome":"clarification","questions":[{"id":"pace","prompt":"Choose a pace","kind":"single_select","options":[]}]}',
      "session-1",
    ),
    /without valid questions/,
  );
});

test("invalid clarification questions fail closed", () => {
  assert.throws(
    () => parseHarnessResult('{"outcome":"clarification","questions":[]}', "session-1"),
    /without valid questions/,
  );
});

test("unstructured output degrades to a general response", () => {
  const state = parseHarnessResult("A useful response", "session-1");
  assert.equal(state.general_result.message, "A useful response");
});

test("HTTP service authenticates and streams NDJSON", async (context) => {
  const config = {
    mode: "fake",
    serviceToken: "test-service-token",
    maxRequestBytes: 262_144,
  };
  const server = createServer({ config, runtime: new FakeRuntime() });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const health = await fetch(`http://127.0.0.1:${port}/health`);
  assert.deepEqual(await health.json(), {
    status: "ok",
    mode: "fake",
    platform: process.platform,
    plugins: { trip_result: false, progress: false, google_places: false, google_routes: false },
  });

  const unauthorized = await fetch(`http://127.0.0.1:${port}/internal/v1/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ run_id: "run-1", conversation_id: "conversation-1", message: "Hi" }),
  });
  assert.equal(unauthorized.status, 401);

  const response = await fetch(`http://127.0.0.1:${port}/internal/v1/execute`, {
    method: "POST",
    headers: {
      authorization: "Bearer test-service-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({ run_id: "run-1", conversation_id: "conversation-1", message: "Hi" }),
  });
  assert.equal(response.status, 200);
  const updates = (await response.text()).trim().split("\n").map(JSON.parse);
  assert.equal(updates[0].kind, "progress");
  assert.equal(updates.at(-1).kind, "completed");
});

test("HTTP service completes an NDJSON failure frame instead of truncating the response", async (context) => {
  const runtime = {
    async *execute() {
      yield { kind: "progress", type: "agent.started", message: "Starting", data: {} };
      throw new Error("provider connection failed");
    },
  };
  const config = {
    mode: "fake",
    serviceToken: "test-service-token",
    maxRequestBytes: 262_144,
  };
  const server = createServer({ config, runtime });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/internal/v1/execute`, {
    method: "POST",
    headers: {
      authorization: "Bearer test-service-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({ run_id: "run-1", conversation_id: "conversation-1", message: "Hi" }),
  });
  const updates = (await response.text()).trim().split("\n").map(JSON.parse);
  assert.equal(response.status, 200);
  assert.equal(updates.at(-1).kind, "failed");
  assert.equal(updates.at(-1).error.code, "HARNESS_EXECUTION_FAILED");
});

test("provider rate limits return a cooldown response without exposing provider output", async (context) => {
  const runtime = {
    async *execute() {
      yield { kind: "progress", type: "agent.started", message: "Starting", data: {} };
      throw new ProviderRateLimitError(12_500);
    },
  };
  const config = {
    mode: "fake",
    serviceToken: "test-service-token",
    maxRequestBytes: 262_144,
  };
  const server = createServer({ config, runtime });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/internal/v1/execute`, {
    method: "POST",
    headers: {
      authorization: "Bearer test-service-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({ run_id: "run-rate-limit", conversation_id: "conversation-1", message: "Continue" }),
  });
  const updates = (await response.text()).trim().split("\n").map(JSON.parse);
  assert.equal(updates.at(-1).error.code, "PROVIDER_RATE_LIMITED");
  assert.match(updates.at(-1).error.message, /wait 13 seconds/iu);
  assert.doesNotMatch(updates.at(-1).error.message, /RATE_LIMIT|429/iu);
  assert.equal(isProviderRateLimitFailure(new Error("dsh: RATE_LIMIT: 429 status code")), true);
});
