import test from "node:test";
import assert from "node:assert/strict";

import {
  commandFor,
  FakeRuntime,
  parseHarnessResult,
  parseProgressLine,
} from "../src/runtime.mjs";
import { formatProgressLine } from "../plugins/progress/index.mjs";
import { renderPluginPatch } from "../src/plugin-patch.mjs";
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
    googlePlacesPlugin: "C:\\tripforge\\plugins\\google-places\\index.mjs",
    googleRoutesPlugin: "C:\\tripforge\\plugins\\google-routes\\index.mjs",
    googleMapsEnabled: true,
    googleRoutesEnabled: false,
    supervisorPrompt: "TripForge supervisor {{model}}",
  });
  assert.match(patch, /name: "file:\/\/\/C:\/tripforge\/plugins\/progress\/index\.mjs"/u);
  assert.doesNotMatch(patch, /!!js|DSH_TRIPFORGE/u);
  assert.match(patch, /disabled: false/u);
  assert.match(patch, /tripforge-google-routes[\s\S]*disabled: true/u);
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
    plugins: { progress: false, google_places: false, google_routes: false },
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
