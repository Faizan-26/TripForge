import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const patchUrl = new URL("../config/tripforge.patch.yml", import.meta.url);
const envExampleUrl = new URL("../.env.example", import.meta.url);

test("TripForge uses NVIDIA NIM Kimi K3 with tool-call reasoning compatibility", async () => {
  const patch = await fs.readFile(patchUrl, "utf8");

  assert.match(patch, /provider: nvidia-nim/u);
  assert.match(patch, /https:\/\/integrate\.api\.nvidia\.com\/v1/u);
  assert.match(patch, /moonshotai\/kimi-k3/u);
  assert.match(patch, /supportsReasoningEffort: true/u);
  assert.match(patch, /requiresReasoningContentOnAssistantMessages: true/u);
  assert.doesNotMatch(patch, /provider: opencode-zen/u);
});

test("environment template uses the low-latency NVIDIA profile without a literal key", async () => {
  const example = await fs.readFile(envExampleUrl, "utf8");

  assert.match(example, /^NVIDIA_API_KEY=$/mu);
  assert.match(example, /^DSH_MODEL=moonshotai\/kimi-k3$/mu);
  assert.match(example, /^DSH_REASONING_EFFORT=low$/mu);
  assert.match(example, /^DSH_MAX_OUTPUT_TOKENS=4096$/mu);
  assert.match(example, /^HARNESS_RATE_LIMIT_COOLDOWN_MS=60000$/mu);
});
