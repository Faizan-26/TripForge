import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writePluginPatch } from "./plugin-patch.mjs";
import { renderPrompt } from "./prompts.mjs";
import {
  isQuestionAnswered,
  prepareWorkflowContext,
  reduceWorkflow,
} from "./workflow.mjs";

export class ProviderRateLimitError extends Error {
  constructor(retryAfterMs) {
    const boundedRetryMs = Number.isFinite(retryAfterMs)
      ? Math.max(1_000, Math.round(retryAfterMs))
      : 60_000;
    super(`Model provider rate limit is active; retry after ${boundedRetryMs}ms`);
    this.name = "ProviderRateLimitError";
    this.code = "PROVIDER_RATE_LIMITED";
    this.retryAfterMs = boundedRetryMs;
  }
}

export function isProviderRateLimitFailure(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /(?:RATE_LIMIT|rate limit|429 status code|HTTP 429)/iu.test(message);
}

export class FakeRuntime {
  async *execute() {
    yield progress("supervisor", "Understanding your message", { runtime: "fake" }, "agent.started");
    yield progress("supervisor", "Preparing your response", { runtime: "fake" }, "answer.preparing");
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
    this.conversationQueues = new Map();
    this.providerRateLimitedUntil = 0;
  }

  async *execute(request, signal) {
    const release = await acquireConversation(
      this.conversationQueues,
      request.conversation_id,
    );
    try {
      if (signal?.aborted) throw new Error("Harness run cancelled");
      yield* this.executeConversation(request, signal);
    } finally {
      release();
    }
  }

  async *executeConversation(request, signal) {
    process.stdout.write(`[harness] run ${request.run_id} starting\n`);
    const sessionId = sessionIdFor(request.conversation_id);
    const effectiveRequest = request;
    const knownContext = compactTaskContext(effectiveRequest);
    yield progress("supervisor", "DeepSeek Harness is starting", {
      runtime: "deepseek",
      session_id: sessionId,
      conversation_id: request.conversation_id,
    }, "agent.started");
    yield workflowProgress(knownContext.workflow);

    const rateLimitRemainingMs = this.providerRateLimitedUntil - Date.now();
    if (rateLimitRemainingMs > 0) {
      throw new ProviderRateLimitError(rateLimitRemainingMs);
    }

    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "tripforge-harness-run-"));
    const dshHome = path.join(workspace, ".dsh");
    await fs.mkdir(dshHome, { recursive: true });
    try {
    process.stdout.write(
      `[harness] run ${request.run_id} launching isolated DeepSeek CLI session ${sessionId}\n`,
    );
    const pluginPatch = path.join(workspace, "tripforge.plugins.patch.yml");
    await writePluginPatch(pluginPatch, this.config);
    const workflowContextPath = path.join(workspace, "tripforge.workflow-context.json");
    await fs.writeFile(workflowContextPath, JSON.stringify(knownContext), {
      encoding: "utf8",
      flag: "wx",
    });
    const task = buildTask(effectiveRequest, this.config.headlessTaskPrompt);
    const { command, args } = commandFor(
      { ...this.config, pluginPatch },
      this.platform,
      task,
    );
    const queuedProgress = [];
    let wake;
    let finished = false;
    let output;
    let failure;
    const runStartedAt = performance.now();
    let heartbeatIndex = 0;
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
        DSH_HOME: dshHome,
        DSH_PERMISSION_MODE: process.env.DSH_PERMISSION_MODE ?? "read-only",
        TRIPFORGE_DSH_SESSION_ID: sessionId,
        TRIPFORGE_WORKFLOW_CONTEXT_PATH: workflowContextPath,
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
        const timer = setTimeout(resolve, 7_000);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
        if (finished || queuedProgress.length > 0) wake();
      });
      wake = undefined;
      if (!finished && queuedProgress.length === 0) {
        const messages = [
          "Reviewing the trip details",
          "Checking the request for missing details",
          "Preparing the next response",
        ];
        yield progress("supervisor", messages[heartbeatIndex % messages.length], {
          runtime: "deepseek",
          elapsed_ms: Math.round(performance.now() - runStartedAt),
        });
        heartbeatIndex += 1;
      }
    }
    await running;
    if (failure) {
      if (isProviderRateLimitFailure(failure)) {
        const configuredCooldownMs = Number(this.config.rateLimitCooldownMs);
        const cooldownMs = Number.isFinite(configuredCooldownMs)
          ? Math.max(1_000, configuredCooldownMs)
          : 60_000;
        this.providerRateLimitedUntil = Date.now() + cooldownMs;
        throw new ProviderRateLimitError(cooldownMs);
      }
      throw failure;
    }

    process.stdout.write(`[harness] run ${request.run_id} completed\n`);
    const finalState = parseHarnessResult(
      output,
      sessionId,
      knownContext,
    );
    yield workflowProgress(finalState.workflow);
    yield completed(finalState);
    } finally {
      await fs.rm(workspace, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  }
}

export function buildRuntime(config) {
  return config.mode === "deepseek" ? new DeepSeekCliRuntime(config) : new FakeRuntime();
}

export function commandFor(config, platform, prompt) {
  const launcherArgs = ["--profile", "headless", "--patch", config.tripforgePatch];
  if (config.pluginPatch) launcherArgs.push("--patch", config.pluginPatch);
  launcherArgs.push(prompt);
  if (config.dshCommand) {
    return {
      command: config.dshCommand,
      args: [...(config.dshPrefixArgs ?? []), ...launcherArgs],
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

export function buildTask(request, template) {
  return renderPrompt(template, {
    USER_MESSAGE: request.message,
    REQUEST_CONTEXT: JSON.stringify(compactTaskContext(request)),
  });
}

export function compactTaskContext(request) {
  const payload = isRecord(request.payload) ? request.payload : {};
  const context = Array.isArray(payload.context)
    ? payload.context.slice(-6).flatMap((turn) => {
        if (!isRecord(turn) || !["user", "assistant"].includes(turn.role)) return [];
        if (typeof turn.content !== "string" || !turn.content.trim()) return [];
        const content = turn.content.trim();
        if (content === request.message || /added the missing trip details/iu.test(content)) return [];
        return [{ role: turn.role, content: content.slice(0, 1000) }];
      }).slice(-4)
    : [];
  const compact = {
    ...(isRecord(payload.answers) && Object.keys(payload.answers).length > 0
      ? { answers: payload.answers }
      : {}),
    ...(typeof payload.intent === "string" ? { intent: payload.intent } : {}),
    ...(isRecord(payload.origin) ? { origin: payload.origin } : {}),
    ...(isRecord(payload.hotel_search) ? { hotel_search: payload.hotel_search } : {}),
    ...(isRecord(payload.selected_hotel) ? { selected_hotel: payload.selected_hotel } : {}),
    ...(isRecord(payload.draft) && Object.keys(payload.draft).length > 0
      ? { draft: payload.draft }
      : {}),
    ...(context.length > 0 ? { recent_context: context } : {}),
  };
  return {
    ...compact,
    workflow: prepareWorkflowContext({
      ...compact,
      workflow: payload.workflow,
    }),
  };
}

function workflowProgress(workflow) {
  const goal = typeof workflow?.current_goal === "string"
    ? workflow.current_goal
    : "request_understanding";
  const status = typeof workflow?.goals?.[goal] === "string"
    ? workflow.goals[goal]
    : "in_progress";
  const messages = {
    request_understanding: "Understanding the travel request",
    trip_requirements: "Collecting the trip requirements",
    hotel_selection: "Preparing grounded hotel choices",
    historical_places: "Researching historical places",
    itinerary: "Building the grounded itinerary",
    complete: "Planning workflow completed",
  };
  return progress("workflow", messages[goal] ?? "Advancing the planning workflow", {
    phase: "workflow",
    goal,
    goal_status: status,
  });
}

export function parseHarnessResult(output, sessionId, knownContext = {}) {
  const text = output.trim();
  const value = parseStructuredOutput(text);
  if (value === undefined) {
    const title = "DeepSeek trip planning session";
    const workflow = reduceWorkflow({
      context: knownContext,
      result: { outcome: "general", mode: "GENERAL_TRAVEL" },
    });
    return withMetadata(
      {
        general_result: {
          intent: "GENERAL",
          message: text || "DeepSeek Harness completed without output.",
          conversation_title: title,
        },
        conversation_title: title,
        workflow,
      },
      sessionId,
    );
  }

  if (value?.outcome === "clarification" && Array.isArray(value.questions)) {
    const draft = {
      ...(isRecord(knownContext.draft) ? knownContext.draft : {}),
      ...(isRecord(value.draft) ? value.draft : {}),
    };
    const questions = normalizeQuestions(value.questions)
      .filter((question) => !isQuestionAnswered(
        question.id,
        isRecord(knownContext.answers) ? knownContext.answers : {},
        draft,
      ));
    if (questions.length === 0) {
      throw new Error(
        "DeepSeek Harness returned clarification without valid questions; all were invalid or previously answered",
      );
    }
    const workflow = reduceWorkflow({ context: knownContext, result: value, questions });
    return withMetadata(
      {
        draft,
        clarifications: questions,
        ui_schema_version: "1",
        conversation_title: value.conversation_title,
        workflow,
      },
      sessionId,
    );
  }
  if (value?.outcome === "general" && typeof value.message === "string") {
    const title = value.conversation_title || "DeepSeek trip planning session";
    const presentation = normalizePresentation(value.presentation);
    const workflow = reduceWorkflow({
      context: knownContext,
      result: { ...value, ...(presentation ? { presentation } : {}) },
    });
    return withMetadata(
      {
        general_result: {
          intent: "GENERAL",
          message: value.message.trim().slice(0, presentation ? 1200 : 6000),
          conversation_title: title,
          ...(presentation ? { presentation } : {}),
        },
        conversation_title: title,
        workflow,
      },
      sessionId,
    );
  }
  throw new Error("DeepSeek Harness returned an unsupported final result schema");
}

export function sessionIdFor(conversationId) {
  return `session-tripforge-${conversationKey(conversationId)}`;
}

function conversationKey(conversationId) {
  return crypto.createHash("sha256").update(String(conversationId)).digest("hex").slice(0, 32);
}

async function acquireConversation(queues, conversationId) {
  const key = String(conversationId);
  const previous = queues.get(key) ?? Promise.resolve();
  let unlock;
  const current = new Promise((resolve) => { unlock = resolve; });
  const tail = previous.then(() => current);
  queues.set(key, tail);
  await previous;
  return () => {
    unlock();
    if (queues.get(key) === tail) queues.delete(key);
  };
}

function parseStructuredOutput(text) {
  const candidates = [
    ...[...text.matchAll(/```json\s*([\s\S]*?)```/gi)].map((match) => match[1]),
    text,
    ...balancedJsonObjects(text),
  ];
  for (const candidate of candidates.reverse()) {
    let value;
    try {
      value = JSON.parse(candidate.trim());
      if (typeof value === "string") value = JSON.parse(value);
    } catch {
      continue;
    }
    if (isRecord(value) && ["clarification", "general"].includes(value.outcome)) {
      return value;
    }
  }
  return undefined;
}

function balancedJsonObjects(text) {
  const objects = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (character === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return objects;
}

const questionKinds = new Set([
  "single_select",
  "multi_select",
  "text",
  "textarea",
  "location",
  "number",
  "date",
  "date_range",
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
    const kind = normalizedQuestionKind(id, prompt, question.kind);
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
            ...normalizeOptionMetadata(option),
          }];
        })
      : [];
    if ((kind === "single_select" || kind === "multi_select") && options.length === 0) return [];
    const minValue = boundedNumber(question.min_value, -1_000_000_000, 1_000_000_000);
    const maxValue = boundedNumber(question.max_value, -1_000_000_000, 1_000_000_000);
    const minLength = boundedInteger(question.min_length, 0, 6000);
    const maxLength = boundedInteger(question.max_length, 1, 6000);
    return [{
      id,
      prompt: prompt.slice(0, 300),
      kind,
      required: question.required !== false,
      options,
      allow_other: question.allow_other === true,
      ...(typeof question.description === "string" ? { description: question.description.slice(0, 500) } : {}),
      ...(typeof question.placeholder === "string"
        ? { placeholder: question.placeholder.slice(0, 160) }
        : kind !== question.kind
          ? { placeholder: "For example: 2 adults and 1 child" }
          : {}),
      ...(kind === "number" && minValue !== undefined ? { min_value: minValue } : {}),
      ...(kind === "number" && maxValue !== undefined ? { max_value: maxValue } : {}),
      ...(kind === "number" && typeof question.step === "number" && question.step > 0
        ? { step: question.step }
        : {}),
      ...(minLength !== undefined ? { min_length: minLength } : {}),
      ...(maxLength !== undefined ? { max_length: maxLength } : {}),
    }];
  });
}

function normalizeOptionMetadata(option) {
  const photoName = typeof option.photo_name === "string"
    && /^places\/[^/]+\/photos\/[^/]+$/u.test(option.photo_name)
    ? option.photo_name.slice(0, 1000)
    : undefined;
  const rating = boundedNumber(option.rating, 0, 5);
  const reviewCount = boundedInteger(option.review_count, 0, 100_000_000);
  return {
    ...(typeof option.place_id === "string"
      ? { place_id: option.place_id.trim().slice(0, 300) }
      : {}),
    ...(typeof option.address === "string"
      ? { address: option.address.trim().slice(0, 500) }
      : {}),
    ...(rating !== undefined ? { rating } : {}),
    ...(reviewCount !== undefined ? { review_count: reviewCount } : {}),
    ...(safeHttpsUrl(option.maps_url, true) ? { maps_url: option.maps_url } : {}),
    ...(typeof option.price_level === "string"
      ? { price_level: option.price_level.trim().slice(0, 80) }
      : {}),
    ...(photoName ? { photo_name: photoName } : {}),
    ...(typeof option.image_alt === "string"
      ? { image_alt: option.image_alt.trim().slice(0, 200) }
      : {}),
    ...(typeof option.image_attribution === "string"
      ? { image_attribution: option.image_attribution.trim().slice(0, 160) }
      : {}),
    ...(safeHttpsUrl(option.image_attribution_url)
      ? { image_attribution_url: option.image_attribution_url }
      : {}),
  };
}

function normalizePresentation(value) {
  if (!isRecord(value) || !["trip_plan", "travel_answer", "hotel_advice"].includes(value.kind)) {
    return undefined;
  }
  const title = boundedText(value.title, 160);
  if (!title) return undefined;
  const facts = Array.isArray(value.facts)
    ? value.facts.slice(0, 8).flatMap((fact) => {
        if (!isRecord(fact)) return [];
        const label = boundedText(fact.label, 60);
        const factValue = boundedText(fact.value, 180);
        return label && factValue ? [{ label, value: factValue }] : [];
      })
    : [];
  const sections = Array.isArray(value.sections)
    ? value.sections.slice(0, 12).flatMap((section) => {
        if (!isRecord(section)) return [];
        const sectionTitle = boundedText(section.title, 160);
        if (!sectionTitle || !Array.isArray(section.items)) return [];
        const items = section.items.slice(0, 8).flatMap((item) => {
          if (!isRecord(item)) return [];
          const itemTitle = boundedText(item.title, 180);
          if (!itemTitle) return [];
          return [{
            title: itemTitle,
            ...(boundedText(item.time, 60) ? { time: boundedText(item.time, 60) } : {}),
            ...(boundedText(item.description, 500)
              ? { description: boundedText(item.description, 500) }
              : {}),
            ...(boundedText(item.location, 240)
              ? { location: boundedText(item.location, 240) }
              : {}),
            ...(safeHttpsUrl(item.maps_url, true) ? { maps_url: item.maps_url } : {}),
          }];
        });
        if (items.length === 0) return [];
        return [{
          title: sectionTitle,
          ...(boundedText(section.subtitle, 240)
            ? { subtitle: boundedText(section.subtitle, 240) }
            : {}),
          items,
        }];
      })
    : [];
  if (sections.length === 0 && facts.length === 0) return undefined;
  const notes = Array.isArray(value.notes)
    ? value.notes.flatMap((note) => boundedText(note, 300) || []).slice(0, 6)
    : [];
  return {
    kind: value.kind,
    title,
    ...(boundedText(value.summary, 500) ? { summary: boundedText(value.summary, 500) } : {}),
    facts,
    sections,
    notes,
  };
}

function boundedText(value, maximum) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function safeHttpsUrl(value, googleOnly = false) {
  if (typeof value !== "string" || value.length > 2000) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    return !googleOnly
      || url.hostname === "maps.google.com"
      || url.hostname === "www.google.com"
      || url.hostname.endsWith(".google.com");
  } catch {
    return false;
  }
}

function travelerCompositionKind(id, prompt, kind) {
  const asksForCombinedCounts = /(?:adult|traveler|guest).*(?:child|children)|(?:child|children).*(?:adult|traveler|guest)/iu;
  const compositionId = /(?:traveler|guest).*(?:composition|breakdown)/iu;
  return asksForCombinedCounts.test(prompt) || compositionId.test(id) ? "text" : kind;
}

function normalizedQuestionKind(id, prompt, kind) {
  const travelerKind = travelerCompositionKind(id, prompt, kind);
  if (travelerKind !== kind) return travelerKind;
  const rangeId = /^(?:travel_dates|stay_dates|date_range|trip_dates)$/iu;
  const asksForRange = /(?:exact|travel|trip|stay|check-in|check in).*(?:dates|check-out|check out|duration)|(?:start|arrival).*(?:end|departure)/iu;
  return rangeId.test(id) || asksForRange.test(prompt) ? "date_range" : kind;
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
    const supported = new Set([
      "agent.started",
      "agent.progress",
      "agent.completed",
      "answer.preparing",
      "tool.started",
      "tool.completed",
      "tool.failed",
    ]);
    return {
      type: supported.has(value.type) ? value.type : "agent.progress",
      agent: typeof value.agent === "string" ? value.agent.slice(0, 100) : "supervisor",
      message: value.message.slice(0, 300),
      data: isRecord(value.data) ? value.data : {},
    };
  } catch {
    return undefined;
  }
}

export function parseResultLine(line) {
  const prefix = "TRIPFORGE_RESULT\t";
  if (!line.startsWith(prefix)) return undefined;
  try {
    const value = JSON.parse(line.slice(prefix.length));
    return isRecord(value) && typeof value.output === "string" && value.output.trim()
      ? value.output
      : undefined;
  } catch {
    return undefined;
  }
}

function createProgressParser(runId, onProgress) {
  let buffer = "";
  let terminalOutput;
  const handle = (line) => {
    const result = parseResultLine(line);
    if (result !== undefined) {
      terminalOutput = result;
      return;
    }
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
      return terminalOutput;
    },
    flush() {
      if (buffer) handle(buffer.replace(/\r$/u, ""));
      buffer = "";
      return terminalOutput;
    },
  };
}

export function runProcess({
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
    let terminalOutput;
    let terminalTimer;

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(terminalTimer);
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
      const detectedOutput = onStderr?.(text);
      if (typeof detectedOutput === "string" && !terminalOutput) {
        if (Buffer.byteLength(detectedOutput, "utf8") > maxOutputBytes) {
          stop();
          finish(() => reject(new Error("Harness output exceeded its configured limit")));
          return;
        }
        terminalOutput = detectedOutput;
        terminalTimer = setTimeout(() => {
          stop();
        }, 100);
        return;
      }
      stderr = (stderr + text).slice(-16_384);
    });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code) => {
      finish(() => {
        if (terminalOutput) resolve(terminalOutput);
        else if (code === 0) resolve(stdout);
        else reject(new Error(`DeepSeek Harness exited with code ${code}: ${stderr}`));
      });
    });
  });
}

function progress(agent, message, data = {}, type = "agent.progress") {
  return {
    kind: "progress",
    type,
    agent,
    message,
    data: { activity_schema_version: "1", ...data },
  };
}

function completed(state) {
  return { kind: "completed", state };
}
