import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const harnessRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function localDshCommand(platform) {
  const executable = platform === "win32" ? "dsh.cmd" : "dsh";
  const candidate = path.join(harnessRoot, "node_modules", ".bin", executable);
  return fs.existsSync(candidate) ? candidate : undefined;
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

  return {
    mode,
    host: env.HARNESS_HOST ?? "127.0.0.1",
    port: Number.parseInt(env.HARNESS_PORT ?? "8090", 10),
    serviceToken: required("HARNESS_SERVICE_TOKEN", env.HARNESS_SERVICE_TOKEN),
    maxRequestBytes: Number.parseInt(env.HARNESS_MAX_REQUEST_BYTES ?? "262144", 10),
    timeoutMs: Number.parseInt(env.HARNESS_RUN_TIMEOUT_MS ?? "300000", 10),
    maxOutputBytes: Number.parseInt(env.HARNESS_MAX_OUTPUT_BYTES ?? "1048576", 10),
    workspaceRoot: path.resolve(env.HARNESS_WORKSPACE_ROOT ?? ".workspaces"),
    dshHome: path.resolve(env.DSH_HOME ?? ".dsh-runtime"),
    tripforgePatch: path.resolve(
      env.DSH_TRIPFORGE_PATCH ?? path.join(harnessRoot, "config", "tripforge.patch.yml"),
    ),
    dshCommand: env.DSH_COMMAND || localDshCommand(process.platform),
    dshPackage: env.DSH_PACKAGE ?? "@deepseek-ai/dsh",
    model: env.DSH_MODEL,
  };
}
