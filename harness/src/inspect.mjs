import { spawn } from "node:child_process";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writePluginPatch } from "./plugin-patch.mjs";
import { loadPromptFile } from "./prompts.mjs";

const harnessRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function buildInspectorLaunch(
  env = process.env,
  platform = process.platform,
  extraArgs = [],
) {
  const port = parsePort(env.HARNESS_INSPECTOR_PORT ?? "8091");
  const localEntrypoint = path.join(
    harnessRoot,
    "node_modules",
    "@deepseek-ai",
    "dsh",
    "lib",
    "bin.js",
  );
  const explicitCommand = env.DSH_COMMAND || undefined;
  if (!explicitCommand && !fs.existsSync(localEntrypoint)) {
    throw new Error("The pinned @deepseek-ai/dsh package is not installed; run npm.cmd install");
  }
  const command = explicitCommand || process.execPath;
  const commandPrefix = explicitCommand ? [] : [localEntrypoint];
  const patch = path.resolve(
    harnessRoot,
    env.DSH_TRIPFORGE_PATCH ?? path.join("config", "tripforge.patch.yml"),
  );
  const inspectorPatch = path.resolve(
    harnessRoot,
    env.DSH_TRIPFORGE_INSPECTOR_PATCH
      ?? path.join("config", "tripforge.inspector.patch.yml"),
  );
  const googlePlacesPlugin = path.resolve(
    harnessRoot,
    env.TRIPFORGE_GOOGLE_PLACES_PLUGIN_PATH
      ?? path.join("plugins", "google-places", "index.mjs"),
  );
  const googleRoutesPlugin = path.resolve(
    harnessRoot,
    env.TRIPFORGE_GOOGLE_ROUTES_PLUGIN_PATH
      ?? path.join("plugins", "google-routes", "index.mjs"),
  );
  const progressPlugin = path.resolve(
    harnessRoot,
    env.TRIPFORGE_PROGRESS_PLUGIN_PATH
      ?? path.join("plugins", "progress", "index.mjs"),
  );
  const tripResultPlugin = path.resolve(
    harnessRoot,
    env.TRIPFORGE_RESULT_PLUGIN_PATH
      ?? path.join("plugins", "trip-result", "index.mjs"),
  );
  const supervisorPromptPath = path.resolve(
    harnessRoot,
    env.TRIPFORGE_SUPERVISOR_PROMPT_PATH
      ?? path.join("prompts", "supervisor.md"),
  );
  const cwd = path.resolve(
    harnessRoot,
    env.HARNESS_INSPECTOR_WORKSPACE ?? ".inspector-workspace",
  );
  const dshHome = path.resolve(
    harnessRoot,
    env.DSH_INSPECTOR_HOME ?? ".dsh-inspector",
  );
  const agentPresetRoot = path.resolve(
    harnessRoot,
    env.TRIPFORGE_AGENT_PRESET_ROOT ?? path.join("config", "agent-presets"),
  );
  const pluginPatch = path.join(cwd, "tripforge.plugins.patch.yml");

  return {
    command,
    cwd,
    dshHome,
    ephemeralDshHome: env.HARNESS_INSPECTOR_EPHEMERAL !== "false",
    pluginPatch,
    pluginConfig: {
      googlePlacesPlugin,
      googleRoutesPlugin,
      progressPlugin,
      tripResultPlugin,
      persistentHeadlessEnabled: false,
      googleMapsEnabled: Boolean(env.GOOGLE_MAPS_API_KEY),
      googleRoutesEnabled:
        Boolean(env.GOOGLE_MAPS_API_KEY)
        && env.TRIPFORGE_GOOGLE_ROUTES_ENABLED === "true",
      supervisorPrompt: loadPromptFile(supervisorPromptPath),
    },
    args: [
      ...commandPrefix,
      "--profile",
      "web",
      "--patch",
      patch,
      "--patch",
      inspectorPatch,
      "--patch",
      pluginPatch,
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      ...extraArgs,
    ],
    env: {
      ...env,
      DSH_HOME: dshHome,
      DSH_PERMISSION_MODE: "read-only",
      TRIPFORGE_AGENT_PRESET_ROOT: agentPresetRoot,
    },
  };
}

export async function runInspector(
  env = process.env,
  platform = process.platform,
  extraArgs = process.argv.slice(2),
) {
  const launch = buildInspectorLaunch(env, platform, extraArgs);
  const runtimeDshHome = launch.ephemeralDshHome
    ? await fsPromises.mkdtemp(path.join(os.tmpdir(), "tripforge-dsh-inspector-"))
    : launch.dshHome;
  await Promise.all([
    fsPromises.mkdir(launch.cwd, { recursive: true }),
    fsPromises.mkdir(runtimeDshHome, { recursive: true }),
  ]);
  await writePluginPatch(launch.pluginPatch, launch.pluginConfig);

  const child = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env: { ...launch.env, DSH_HOME: runtimeDshHome },
    shell: false,
    stdio: "inherit",
    windowsHide: true,
  });
  const stop = () => child.kill("SIGTERM");
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    return await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => {
        process.removeListener("SIGINT", stop);
        process.removeListener("SIGTERM", stop);
        if (signal) reject(new Error(`TripForge inspector stopped by ${signal}`));
        else resolve(code ?? 1);
      });
    });
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    if (launch.ephemeralDshHome) {
      await fsPromises.rm(runtimeDshHome, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  }
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("HARNESS_INSPECTOR_PORT must be an integer between 1 and 65535");
  }
  return port;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await runInspector();
  } catch (error) {
    process.stderr.write(`TripForge inspector failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
