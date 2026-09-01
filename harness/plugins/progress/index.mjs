const PREFIX = "TRIPFORGE_PROGRESS\t";
const RESULT_PREFIX = "TRIPFORGE_RESULT\t";
const REDACTED_KEY = /authorization|api[_-]?key|password|secret|token/i;
const ACTIVITY_SCHEMA_VERSION = "1";
const UPDATE_INTERVAL_MS = 5_000;

export const name = "tripforge-progress";
export const inject = ["tools", "sessions"];

export function apply(ctx) {
  const startedAt = new WeakMap();
  const sessionState = new WeakMap();
  ctx.on("session/event", (session, event) => {
    if (event.type === "turn/start") {
      sessionState.set(session, {
        turnStartedAt: event.time,
        stepStartedAt: undefined,
        firstTokenAt: undefined,
        lastUpdateAt: 0,
      });
      publish({
        type: "agent.progress",
        agent: "supervisor",
        message: "Reviewing your trip request",
        data: { turn: event.data.turn, phase: "planning" },
      });
      return;
    }
    if (event.type === "step/start") {
      const state = stateFor(sessionState, session);
      state.stepStartedAt = event.time;
      state.firstTokenAt = undefined;
      state.lastUpdateAt = 0;
      publish({
        type: "agent.progress",
        agent: "supervisor",
        message: event.data.step === 1 ? "Travel model is responding" : "Refining the trip response",
        data: { turn: event.data.turn, step: event.data.step, phase: "model_request" },
      });
      return;
    }
    if (event.type === "assistant/chunk") {
      const chunkType = event.data.chunk?.type;
      if (chunkType !== "reasoning-delta" && chunkType !== "text-delta") return;
      const state = stateFor(sessionState, session);
      if (state.firstTokenAt === undefined) state.firstTokenAt = event.time;
      if (event.time - state.lastUpdateAt < UPDATE_INTERVAL_MS) return;
      state.lastUpdateAt = event.time;
      publish({
        type: "agent.progress",
        agent: "supervisor",
        message: chunkType === "reasoning-delta"
          ? "Evaluating your preferences and constraints"
          : "Drafting the trip response",
        data: timingData(state, event.time, {
          turn: event.data.turn,
          step: event.data.step,
          phase: chunkType === "reasoning-delta" ? "evaluation" : "drafting",
        }),
      });
      return;
    }
    if (event.type === "assistant/message") {
      const content = Array.isArray(event.data.message?.content)
        ? event.data.message.content
        : [];
      const finalText = content
        .filter((block) => block?.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("")
        .trim();
      const hasToolCall = content.some((block) => block?.type === "tool-call");
      if (!finalText || hasToolCall) return;
      const state = stateFor(sessionState, session);
      publish({
        type: "answer.preparing",
        agent: "supervisor",
        message: "Finalizing your response",
        data: timingData(state, event.time, {
          turn: event.data.turn,
          step: event.data.step,
          phase: "finalizing",
        }),
      });
      publish({
        type: "agent.completed",
        agent: "supervisor",
        message: "Travel model completed",
        data: timingData(state, event.time, {
          turn: event.data.turn,
          step: event.data.step,
          phase: "model_completed",
          ...usageData(event.data.usage),
        }),
      });
    }
  });

  ctx.on("tools/pre-execute", (exec, next) => {
    if (!isPublicActivityTool(exec.name)) return next();
    startedAt.set(exec, performance.now());
    publish({
      type: "tool.started",
      agent: agentId(exec),
      message: toolMessage(exec.name, "running"),
      data: {
        tool: exec.name,
        call_id: String(exec.callId),
        arguments: sanitize(exec.arguments),
      },
    });
    return next();
  }, { prepend: true });

  ctx.on("tools/result", (exec, result) => {
    if (!isPublicActivityTool(exec.name)) return;
    const start = startedAt.get(exec);
    startedAt.delete(exec);
    const durationMs = start === undefined ? undefined : Math.max(0, performance.now() - start);
    publish({
      type: result.isError ? "tool.failed" : "tool.completed",
      agent: agentId(exec),
      message: toolMessage(exec.name, result.isError ? "failed" : "completed"),
      data: {
        tool: exec.name,
        call_id: String(exec.callId),
        status: result.isError ? "failed" : "completed",
        ...(durationMs === undefined ? {} : { duration_ms: Math.round(durationMs) }),
        ...(result.isError ? { error: String(result.error?.message ?? "Tool failed").slice(0, 300) } : {}),
      },
    });
  });
}

export function isPublicActivityTool(toolName) {
  return toolName !== "submit_trip_response";
}

export function formatProgressLine(event) {
  return `${PREFIX}${JSON.stringify(event)}\n`;
}

export function formatResultLine(output) {
  return `${RESULT_PREFIX}${JSON.stringify({ output })}\n`;
}

function publish(event) {
  process.stderr.write(formatProgressLine({
    ...event,
    data: {
      activity_schema_version: ACTIVITY_SCHEMA_VERSION,
      ...(event.data ?? {}),
    },
  }));
}

function stateFor(states, session) {
  let state = states.get(session);
  if (!state) {
    state = {
      turnStartedAt: undefined,
      stepStartedAt: undefined,
      firstTokenAt: undefined,
      lastUpdateAt: 0,
    };
    states.set(session, state);
  }
  return state;
}

function timingData(state, now, extra = {}) {
  const startedAt = state.stepStartedAt ?? state.turnStartedAt;
  return {
    ...extra,
    ...(startedAt === undefined ? {} : { duration_ms: Math.max(0, now - startedAt) }),
    ...(state.stepStartedAt === undefined || state.firstTokenAt === undefined
      ? {}
      : { first_token_ms: Math.max(0, state.firstTokenAt - state.stepStartedAt) }),
  };
}

function usageData(usage) {
  if (!usage || typeof usage !== "object") return {};
  return {
    ...(Number.isFinite(usage.inputTokens) ? { input_tokens: usage.inputTokens } : {}),
    ...(Number.isFinite(usage.outputTokens) ? { output_tokens: usage.outputTokens } : {}),
    ...(Number.isFinite(usage.reasoningTokens) ? { reasoning_tokens: usage.reasoningTokens } : {}),
  };
}

function agentId(exec) {
  const preset = exec.agent?.session?.meta?.agentPreset;
  return typeof preset === "string" && preset ? preset : "supervisor";
}

function toolMessage(tool, phase) {
  const labels = {
    search_google_places: "Google Places search",
    compute_google_route: "Google route calculation",
  };
  const label = labels[tool] ?? tool.replaceAll("_", " ");
  return `${label} ${phase}`;
}

function sanitize(value, depth = 0) {
  if (depth > 4) return "[truncated]";
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 300);
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitize(item, depth + 1));
  if (!value || typeof value !== "object") return String(value).slice(0, 100);
  return Object.fromEntries(
    Object.entries(value).slice(0, 30).map(([key, item]) => [
      key,
      REDACTED_KEY.test(key) ? "[redacted]" : sanitize(item, depth + 1),
    ]),
  );
}
