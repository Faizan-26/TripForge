import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const patchUrl = new URL("../config/tripforge.patch.yml", import.meta.url);
const envExampleUrl = new URL("../.env.example", import.meta.url);
const mistralCatalogUrl = new URL(
  "../node_modules/@earendil-works/pi-ai/dist/providers/data/mistral.json",
  import.meta.url,
);

test("TripForge uses the native Mistral adapter with reasoning explicitly disabled", async () => {
  const patch = await fs.readFile(patchUrl, "utf8");

  assert.match(patch, /provider: mistral/u);
  assert.match(patch, /mistral-medium-3\.5/u);
  assert.match(patch, /reasoning: !!js process\.env\.DSH_REASONING_EFFORT \?\? 'low'/u);
  assert.match(patch, /modelOverrides:[\s\S]*mistral-medium-3\.5:/u);
  assert.match(patch, /reasoningEfforts:[\s\S]*low: none[\s\S]*high: high/u);
  assert.doesNotMatch(patch, /chatTemplateKwargs|moonshot|kimi|nvidia-nim|deepseek-v4/iu);
  assert.doesNotMatch(patch, /^\s+api: openai-completions$/mu);
  assert.doesNotMatch(patch, /^\s+baseURL:/mu);
  assert.doesNotMatch(patch, /^\s+compat:/mu);
  assert.equal((patch.match(/DSH_MAX_OUTPUT_TOKENS \?\? 8192/gu) ?? []).length, 1);
  assert.match(patch, /DSH_PROVIDER_TIMEOUT_MS \?\? 60000/u);
  assert.match(patch, /DSH_PROVIDER_IDLE_TIMEOUT_MS \?\? 45000/u);
  assert.match(patch, /DSH_PROVIDER_MAX_RETRIES \?\? 1/u);
  assert.doesNotMatch(patch, /provider: opencode-zen/u);
});

test("installed pi-ai catalog routes Mistral Medium 3.5 through its native protocol", async () => {
  const catalog = JSON.parse(await fs.readFile(mistralCatalogUrl, "utf8"));
  const model = catalog["mistral-conversations"]?.["mistral-medium-3.5"];

  assert.equal(model?.api, "mistral-conversations");
  assert.equal(model?.reasoning, true);
  assert.equal(model?.contextWindow, 262144);
});

test("environment template uses the low-latency Mistral profile without a literal key", async () => {
  const example = await fs.readFile(envExampleUrl, "utf8");

  assert.match(example, /^MISTRAL_API_KEY=$/mu);
  assert.match(example, /^# NVIDIA_API_KEY=$/mu);
  assert.match(example, /^DSH_MODEL=mistral-medium-3\.5$/mu);
  assert.match(example, /^DSH_REASONING_EFFORT=low$/mu);
  assert.match(example, /^DSH_CONTEXT_WINDOW_TOKENS=262144$/mu);
  assert.match(example, /^DSH_MAX_OUTPUT_TOKENS=8192$/mu);
  assert.match(example, /^DSH_PROVIDER_TIMEOUT_MS=60000$/mu);
  assert.match(example, /^DSH_PROVIDER_IDLE_TIMEOUT_MS=45000$/mu);
  assert.match(example, /^DSH_PROVIDER_MAX_RETRIES=1$/mu);
  assert.match(example, /^HARNESS_RUN_TIMEOUT_MS=180000$/mu);
  assert.match(example, /^HARNESS_RATE_LIMIT_COOLDOWN_MS=60000$/mu);
});
