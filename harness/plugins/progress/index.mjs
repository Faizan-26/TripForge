const PREFIX = "TRIPFORGE_PROGRESS\t";
const REDACTED_KEY = /authorization|api[_-]?key|password|secret|token/i;
const ACTIVITY_SCHEMA_VERSION = "1";

export const name = "tripforge-progress";
export const inject = ["tools", "sessions"];

export function apply(ctx) {
  const startedAt = new WeakMap();
  ctx.on("session/event", (_session, event) => {
    if (event.type === "turn/start") {
      publish({
        type: "agent.progress",
        agent: "supervisor",
        message: "Reviewing your trip request",
        data: { turn: event.data.turn },
      });
      return;
    }
    if (event.type === "step/start") {
      publish({
        type: "agent.progress",
        agent: "supervisor",
        message: event.data.step === 1
          ? "Working out the best next step"
          : "Refining the trip response",
        data: { turn: event.data.turn, step: event.data.step },
      });
      return;
    }
    if (event.type === "assistant/message") {
      const content = Array.isArray(event.data.message?.content)
        ? event.data.message.content
        : [];
      const hasFinalText = content.some((block) => (
        block?.type === "text" && typeof block.text === "string" && block.text.trim()
      ));
      const hasToolCall = content.some((block) => block?.type === "tool-call");
      if (!hasFinalText || hasToolCall) return;
      publish({
        type: "answer.preparing",
        agent: "supervisor",
        message: "Preparing your response",
        data: { turn: event.data.turn, step: event.data.step },
      });
    }
  });

  ctx.on("tools/pre-execute", (exec, next) => {
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

export function formatProgressLine(event) {
  return `${PREFIX}${JSON.stringify(event)}\n`;
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
