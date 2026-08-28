import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadPromptFile, renderPrompt } from "../src/prompts.mjs";
import { buildTask, compactTaskContext } from "../src/runtime.mjs";

test("headless task prompt renders request values without changing user text", () => {
  const result = buildTask(
    { message: "Plan {{literal}}", payload: { answers: { travelers: 2 } } },
    "Request: {{USER_MESSAGE}}\nContext: {{REQUEST_CONTEXT}}",
  );
  assert.equal(result, 'Request: Plan {{literal}}\nContext: {"answers":{"travelers":2}}');
});

test("headless context omits identifiers, duplicate messages, and unrelated payload fields", () => {
  const context = compactTaskContext({
    message: "Plan a trip to Lahore",
    payload: {
      conversation_id: "private-id",
      client_request_id: "request-id",
      answers: { budget: "PKR 150,000" },
      intent: "FULL_TRIP_PLAN",
      context: [
        { role: "user", content: "Plan a trip to Lahore" },
        { role: "assistant", content: "A few choices will help." },
        { role: "user", content: "I've added the missing trip details." },
      ],
    },
  });
  assert.deepEqual(context, {
    answers: { budget: "PKR 150,000" },
    intent: "FULL_TRIP_PLAN",
    recent_context: [{ role: "assistant", content: "A few choices will help." }],
  });
});

test("prompt rendering rejects missing declared placeholders", () => {
  assert.throws(
    () => renderPrompt("Hello {{MISSING_VALUE}}", {}),
    /was not supplied/u,
  );
});

test("supervisor prompt is travel-only and collects complete planning inputs", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const prompt = loadPromptFile(path.join(root, "prompts", "supervisor.md"));
  for (const requirement of [
    "origin",
    "destination",
    "dates",
    "adults and children",
    "budget with currency",
    "hotel search",
    "Do not call tools until required details are complete",
  ]) {
    assert.match(prompt, new RegExp(requirement, "iu"));
  }
});
