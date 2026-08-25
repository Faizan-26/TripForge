import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export class FakeRuntime {
  async *execute() {
    yield progress("supervisor", "Understanding your message", { runtime: "fake" });
    yield completed({
      general_result: {
        intent: "GENERAL",
        message:
          "The DeepSeek Harness service connection is working. " +
          "Switch HARNESS_MODE to deepseek after installing the official CLI.",
        conversation_title: "Harness integration test",
      },
      conversation_title: "Harness integration test",
    });
  }
}

export class DeepSeekCliRuntime {
  constructor(config, platform = process.platform) {
    this.config = config;
    this.platform = platform;
  }

  async *execute(request, signal) {
    process.stdout.write(`[harness] run ${request.run_id} starting with DeepSeek CLI\n`);
    yield progress("supervisor", "DeepSeek Harness is starting", {
      runtime: "deepseek",
      session_id: request.conversation_id,
    });

    const workspace = path.join(this.config.workspaceRoot, request.run_id);
    await fs.mkdir(workspace, { recursive: true });
    const task = buildTask(request);
    const { command, args } = commandFor(this.config, this.platform, task);
    const queuedProgress = [];
    let wake;
    let finished = false;
    let output;
    let failure;
    const stderr = createProgressParser(request.run_id, (event) => {
      queuedProgress.push(progress(event.agent, event.message, event.data, event.type));
      wake?.();
    });
    const running = runProcess({
      command,
      args,
      cwd: workspace,
      env: {
        ...process.env,
        DSH_HOME: this.config.dshHome,
        DSH_PERMISSION_MODE: process.env.DSH_PERMISSION_MODE ?? "read-only",
        DSH_TRIPFORGE_GOOGLE_PLACES_PLUGIN: pathToFileURL(
          this.config.googlePlacesPlugin,
        ).href,
        DSH_TRIPFORGE_PROGRESS_PLUGIN: pathToFileURL(this.config.progressPlugin).href,
      },
      timeoutMs: this.config.timeoutMs,
      maxOutputBytes: this.config.maxOutputBytes,
      signal,
      onStderr: (chunk) => stderr.push(chunk),
    }).then(
      (value) => { output = value; },
      (error) => { failure = error; },
    ).finally(() => {
      stderr.flush();
      finished = true;
      wake?.();
    });

    while (!finished || queuedProgress.length > 0) {
      if (queuedProgress.length > 0) {
        yield queuedProgress.shift();
        continue;
      }
      await new Promise((resolve) => {
        wake = resolve;
        if (finished || queuedProgress.length > 0) resolve();
      });
      wake = undefined;
    }
    await running;
    if (failure) throw failure;

    process.stdout.write(`[harness] run ${request.run_id} completed\n`);
    yield completed(parseHarnessResult(output, request.conversation_id));
  }
}

export function buildRuntime(config) {
  return config.mode === "deepseek" ? new DeepSeekCliRuntime(config) : new FakeRuntime();
}

export function commandFor(config, platform, prompt) {
  const launcherArgs = ["--profile", "headless", "--patch", config.tripforgePatch, prompt];
  if (config.dshCommand) {
    return {
      command: config.dshCommand,
      args: launcherArgs,
    };
  }

  return {
    command: platform === "win32" ? "npx.cmd" : "npx",
    args: [
      "--yes",
      config.dshPackage ?? "@deepseek-ai/dsh",
      ...launcherArgs,
    ],
  };
}

export function buildTask(request) {
  return `You are the TripForge supervisor running inside DeepSeek Harness.

Your current responsibility is intake and routing. Do not invent hotels, places,
prices, availability, routes, or weather. Delegate analysis when useful, but return
one final machine-readable JSON object and no prose outside it.

User request:
${request.message}

Structured request context:
${JSON.stringify(request.payload ?? {})}

Return exactly one of these shapes:
{"outcome":"general","message":"...","conversation_title":"..."}
{"outcome":"clarification","ui_schema_version":"1","draft":{},"questions":[{"id":"snake_case_id","kind":"single_select|multi_select|text|textarea|location|number|date|boolean","prompt":"...","description":"...","placeholder":"...","required":true,"allow_other":false,"min_value":null,"max_value":null,"step":null,"min_length":null,"max_length":null,"options":[{"value":"...","label":"...","description":"..."}]}],"conversation_title":"..."}

Ask only questions required to proceed. For a full trip plan, required basics are
destination, traveler count, and either dates or duration. Research and itinerary
generation are not enabled in this migration slice, so if those basics are present,
state that tool-backed planning is still being connected instead of fabricating a plan.
When search_google_places is available, use it for current place, hotel, restaurant,
and attraction discovery questions. Base claims only on its results and retain provider
IDs and Google Maps links when they are useful to the traveler.
Use select fields only when you supply options. Use date for a single ISO date, boolean
for yes/no, and textarea only when a longer answer is genuinely useful. Never return
HTML, JavaScript, CSS, URLs for UI controls, or an unlisted question kind.`;
}

export function parseHarnessResult(output, sessionId) {
  const text = output.trim();
  const fenced = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)].at(-1)?.[1];
  let value;
  try {
    value = JSON.parse((fenced ?? text).trim());
  } catch {
    const title = "DeepSeek trip planning session";
    return withMetadata(
      {
        general_result: {
          intent: "GENERAL",
          message: text || "DeepSeek Harness completed without output.",
          conversation_title: title,
        },
        conversation_title: title,
      },
      sessionId,
    );
  }

  if (value?.outcome === "clarification" && Array.isArray(value.questions)) {
    const questions = normalizeQuestions(value.questions);
    if (questions.length === 0) {
      throw new Error("DeepSeek Harness returned clarification without valid questions");
    }
    return withMetadata(
      {
        draft: isRecord(value.draft) ? value.draft : {},
        clarifications: questions,
        ui_schema_version: "1",
        conversation_title: value.conversation_title,
      },
      sessionId,
    );
  }
  if (value?.outcome === "general" && typeof value.message === "string") {
    const title = value.conversation_title || "DeepSeek trip planning session";
    return withMetadata(
      {
        general_result: {
          intent: "GENERAL",
          message: value.message,
          conversation_title: title,
        },
        conversation_title: title,
      },
      sessionId,
    );
  }
  throw new Error("DeepSeek Harness returned an unsupported final result schema");
}

const questionKinds = new Set([
  "single_select",
  "multi_select",
  "text",
  "textarea",
  "location",
  "number",
  "date",
  "boolean",
]);

function normalizeQuestions(questions) {
  const seen = new Set();
  return questions.slice(0, 8).flatMap((question) => {
    if (!isRecord(question)) return [];
    const id = typeof question.id === "string" ? question.id.trim() : "";
    const prompt = typeof question.prompt === "string" ? question.prompt.trim() : "";
    if (!/^[a-z][a-z0-9_]{0,79}$/.test(id) || !prompt || seen.has(id) || !questionKinds.has(question.kind)) return [];
    seen.add(id);
    const options = Array.isArray(question.options)
      ? question.options.slice(0, 12).flatMap((option) => {
          if (!isRecord(option)) return [];
          const value = typeof option.value === "string" ? option.value.trim() : "";
          const label = typeof option.label === "string" ? option.label.trim() : "";
          if (!value || !label) return [];
          return [{
            value,
            label,
            ...(typeof option.description === "string"
              ? { description: option.description.slice(0, 300) }
              : {}),
          }];
        })
      : [];
    if ((question.kind === "single_select" || question.kind === "multi_select") && options.length === 0) return [];
    const minValue = boundedNumber(question.min_value, -1_000_000_000, 1_000_000_000);
    const maxValue = boundedNumber(question.max_value, -1_000_000_000, 1_000_000_000);
    const minLength = boundedInteger(question.min_length, 0, 6000);
    const maxLength = boundedInteger(question.max_length, 1, 6000);
    return [{
      id,
      prompt: prompt.slice(0, 300),
      kind: question.kind,
      required: question.required !== false,
      options,
      allow_other: question.allow_other === true,
      ...(typeof question.description === "string" ? { description: question.description.slice(0, 500) } : {}),
      ...(typeof question.placeholder === "string" ? { placeholder: question.placeholder.slice(0, 160) } : {}),
      ...(minValue !== undefined ? { min_value: minValue } : {}),
      ...(maxValue !== undefined ? { max_value: maxValue } : {}),
      ...(typeof question.step === "number" && question.step > 0 ? { step: question.step } : {}),
      ...(minLength !== undefined ? { min_length: minLength } : {}),
      ...(maxLength !== undefined ? { max_length: maxLength } : {}),
    }];
  });
}

function boundedNumber(value, minimum, maximum) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : undefined;
}

function boundedInteger(value, minimum, maximum) {
  return Number.isInteger(value) ? boundedNumber(value, minimum, maximum) : undefined;
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function withMetadata(state, sessionId) {
  return {
    ...state,
    harness: { provider: "deepseek", session_id: sessionId },
  };
}

export function parseProgressLine(line) {
  const prefix = "TRIPFORGE_PROGRESS\t";
  if (!line.startsWith(prefix)) return undefined;
  try {
    const value = JSON.parse(line.slice(prefix.length));
    if (!isRecord(value) || typeof value.message !== "string") return undefined;
    const supported = new Set(["tool.started", "tool.completed", "tool.failed"]);
    return {
      type: supported.has(value.type) ? value.type : "tool.progress",
      agent: typeof value.agent === "string" ? value.agent.slice(0, 100) : "supervisor",
      message: value.message.slice(0, 300),
      data: isRecord(value.data) ? value.data : {},
    };
  } catch {
    return undefined;
  }
}

function createProgressParser(runId, onProgress) {
  let buffer = "";
  const handle = (line) => {
    const event = parseProgressLine(line);
    if (event) onProgress(event);
    else if (line) process.stderr.write(`[dsh:${runId}] ${line}\n`);
  };
  return {
    push(chunk) {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        handle(buffer.slice(0, newline).replace(/\r$/u, ""));
        buffer = buffer.slice(newline + 1);
      }
    },
    flush() {
      if (buffer) handle(buffer.replace(/\r$/u, ""));
      buffer = "";
    },
  };
}

function runProcess({
  command,
  args,
  cwd,
  env,
  timeoutMs,
  maxOutputBytes,
  signal,
  onStderr,
}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      callback();
    };
    const stop = () => child.kill("SIGTERM");
    const abort = () => {
      stop();
      finish(() => reject(new Error("Harness run cancelled")));
    };
    const timer = setTimeout(() => {
      stop();
      finish(() => reject(new Error(`Harness run exceeded ${timeoutMs}ms`)));
    }, timeoutMs);

    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        stop();
        finish(() => reject(new Error("Harness output exceeded its configured limit")));
        return;
      }
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stderr = (stderr + text).slice(-16_384);
      onStderr?.(text);
    });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code) => {
      finish(() => {
        if (code === 0) resolve(stdout);
        else reject(new Error(`DeepSeek Harness exited with code ${code}: ${stderr}`));
      });
    });
  });
}

function progress(agent, message, data = {}, type = "agent.progress") {
  return { kind: "progress", type, agent, message, data };
}

function completed(state) {
  return { kind: "completed", state };
}
