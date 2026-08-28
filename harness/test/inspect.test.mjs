import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { buildInspectorLaunch } from "../src/inspect.mjs";

test("Windows inspector uses the local DSH Web profile and isolated workspace", () => {
  const launch = buildInspectorLaunch({
    HARNESS_INSPECTOR_PORT: "9011",
    DSH_MODEL: "test-model",
  }, "win32", ["--no-open"]);

  assert.match(path.basename(launch.command), /^node(?:\.exe)?$/iu);
  assert.equal(path.basename(launch.args[0]), "bin.js");
  assert.deepEqual(launch.args.slice(1, 5), [
    "--profile",
    "web",
    "--patch",
    launch.args[4],
  ]);
  assert.equal(launch.args[5], "--patch");
  assert.equal(path.basename(launch.args[6]), "tripforge.inspector.patch.yml");
  assert.deepEqual(launch.args.slice(7, 9), ["--patch", launch.pluginPatch]);
  assert.deepEqual(launch.args.slice(-5), [
    "--host",
    "127.0.0.1",
    "--port",
    "9011",
    "--no-open",
  ]);
  assert.equal(path.basename(launch.cwd), ".inspector-workspace");
  assert.equal(path.basename(launch.dshHome), ".dsh-inspector");
  assert.equal(launch.ephemeralDshHome, true);
  assert.equal(path.dirname(launch.pluginPatch), launch.cwd);
  assert.equal(launch.pluginConfig.googleMapsEnabled, false);
  assert.equal(launch.pluginConfig.googleRoutesEnabled, false);
  assert.match(launch.pluginConfig.supervisorPrompt, /TripForge/u);
  assert.equal(launch.env.DSH_PERMISSION_MODE, "read-only");
  assert.equal(
    path.basename(launch.env.TRIPFORGE_AGENT_PRESET_ROOT),
    "agent-presets",
  );
});

test("Inspector rejects unsafe ports before starting DSH", () => {
  assert.throws(
    () => buildInspectorLaunch({ HARNESS_INSPECTOR_PORT: "70000" }, "win32"),
    /between 1 and 65535/,
  );
});
