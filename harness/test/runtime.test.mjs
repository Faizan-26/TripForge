import test from "node:test";
import assert from "node:assert/strict";

import { commandFor, FakeRuntime, parseHarnessResult } from "../src/runtime.mjs";
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

test("fake runtime emits progress followed by completion", async () => {
  const updates = [];
  for await (const update of new FakeRuntime().execute({})) updates.push(update);
  assert.equal(updates[0].kind, "progress");
  assert.equal(updates.at(-1).kind, "completed");
});

test("execution contract rejects missing identifiers", () => {
  assert.throws(() => validateExecuteRequest({ message: "Plan a trip" }), /run_id/);
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
