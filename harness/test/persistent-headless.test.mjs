import test from "node:test";
import assert from "node:assert/strict";

import {
  selectTerminalOutput,
  summarize,
} from "../plugins/persistent-headless/index.mjs";

test("persistent headless summarizes only the newly resumed turn", () => {
  const outcome = summarize([
    { seq: 0, type: "turn/start", data: {} },
    {
      seq: 1,
      type: "assistant/message",
      data: { message: { content: [{ type: "text", text: "Old answer" }] } },
    },
    { seq: 2, type: "turn/end", data: { reason: { kind: "completed" } } },
    { seq: 3, type: "turn/start", data: {} },
    {
      seq: 4,
      type: "assistant/message",
      data: { message: { content: [{ type: "text", text: "New answer" }] } },
    },
    { seq: 5, type: "turn/end", data: { reason: { kind: "completed" } } },
  ], 3);

  assert.equal(outcome.text, "New answer");
  assert.equal(outcome.reason.kind, "completed");
});

test("persistent headless never publishes provider error text as a terminal result", () => {
  const failed = {
    text: "RATE_LIMIT: 429 status code",
    reason: { kind: "error", error: { code: "RATE_LIMIT" } },
  };
  assert.equal(selectTerminalOutput(undefined, failed), "");
  assert.equal(selectTerminalOutput('{"outcome":"general"}', failed), "");
  assert.equal(selectTerminalOutput(undefined, {
    text: "A completed response",
    reason: { kind: "completed" },
  }), "A completed response");
});
