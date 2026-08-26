import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadPromptFile, renderPrompt } from "../src/prompts.mjs";
import { buildTask } from "../src/runtime.mjs";

test("headless task prompt renders request values without changing user text", () => {
  const result = buildTask(
    { message: "Plan {{literal}}", payload: { travelers: 2 } },
    "Request: {{USER_MESSAGE}}\nContext: {{REQUEST_CONTEXT}}",
  );
  assert.equal(result, 'Request: Plan {{literal}}\nContext: {"travelers":2}');
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
