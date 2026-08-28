import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPromptFile } from "./prompts.mjs";

const harnessRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function localDshLaunch() {
  const entrypoint = path.join(
    harnessRoot,
    "node_modules",
    "@deepseek-ai",
    "dsh",
    "lib",
    "bin.js",
  );
  return fs.existsSync(entrypoint)
    ? { command: process.execPath, prefixArgs: [entrypoint] }
    : undefined;
}

function required(name, value) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function loadConfig(env = process.env) {
  const mode = env.HARNESS_MODE ?? "fake";
  if (!["fake", "deepseek"].includes(mode)) {
    throw new Error("HARNESS_MODE must be fake or deepseek");
  }

  const localDsh = localDshLaunch();
  const explicitDshCommand = env.DSH_COMMAND || undefined;
  const googleMapsEnabled = Boolean(env.GOOGLE_MAPS_API_KEY);
  const supervisorPromptPath = path.resolve(
    env.TRIPFORGE_SUPERVISOR_PROMPT_PATH
      ?? path.join(harnessRoot, "prompts", "supervisor.md"),
  );
  const headlessTaskPromptPath = path.resolve(
    env.TRIPFORGE_HEADLESS_TASK_PROMPT_PATH
      ?? path.join(harnessRoot, "prompts", "headless-task.md"),
  );
  return {
    mode,
    host: env.HARNESS_HOST ?? "127.0.0.1",
    port: Number.parseInt(env.HARNESS_PORT ?? "8090", 10),
    serviceToken: required("HARNESS_SERVICE_TOKEN", env.HARNESS_SERVICE_TOKEN),
    maxRequestBytes: Number.parseInt(env.HARNESS_MAX_REQUEST_BYTES ?? "262144", 10),
    timeoutMs: Number.parseInt(env.HARNESS_RUN_TIMEOUT_MS ?? "300000", 10),
    rateLimitCooldownMs: Number.parseInt(
      env.HARNESS_RATE_LIMIT_COOLDOWN_MS ?? "60000",
      10,
    ),
    maxOutputBytes: Number.parseInt(env.HARNESS_MAX_OUTPUT_BYTES ?? "1048576", 10),
    tripforgePatch: path.resolve(
      env.DSH_TRIPFORGE_PATCH ?? path.join(harnessRoot, "config", "tripforge.patch.yml"),
    ),
    googlePlacesPlugin: path.resolve(
      env.TRIPFORGE_GOOGLE_PLACES_PLUGIN_PATH
        ?? path.join(harnessRoot, "plugins", "google-places", "index.mjs"),
    ),
    googleRoutesPlugin: path.resolve(
      env.TRIPFORGE_GOOGLE_ROUTES_PLUGIN_PATH
        ?? path.join(harnessRoot, "plugins", "google-routes", "index.mjs"),
    ),
    progressPlugin: path.resolve(
      env.TRIPFORGE_PROGRESS_PLUGIN_PATH
        ?? path.join(harnessRoot, "plugins", "progress", "index.mjs"),
    ),
    tripResultPlugin: path.resolve(
      env.TRIPFORGE_RESULT_PLUGIN_PATH
        ?? path.join(harnessRoot, "plugins", "trip-result", "index.mjs"),
    ),
    persistentHeadlessPlugin: path.resolve(
      env.TRIPFORGE_PERSISTENT_HEADLESS_PLUGIN_PATH
        ?? path.join(harnessRoot, "plugins", "persistent-headless", "index.mjs"),
    ),
    persistentHeadlessEnabled: true,
    dshCommand: explicitDshCommand || localDsh?.command,
    dshPrefixArgs: explicitDshCommand ? [] : localDsh?.prefixArgs ?? [],
    dshPackage: env.DSH_PACKAGE ?? "@deepseek-ai/dsh",
    model: env.DSH_MODEL,
    googleMapsEnabled,
    googleRoutesEnabled:
      googleMapsEnabled && env.TRIPFORGE_GOOGLE_ROUTES_ENABLED === "true",
    supervisorPromptPath,
    supervisorPrompt: loadPromptFile(supervisorPromptPath),
    headlessTaskPromptPath,
    headlessTaskPrompt: loadPromptFile(headlessTaskPromptPath),
  };
}
