const PREFIX = "TRIPFORGE_PROGRESS\t";
const REDACTED_KEY = /authorization|api[_-]?key|password|secret|token/i;

export const name = "tripforge-progress";
export const inject = ["tools"];

export function apply(ctx) {
  const startedAt = new WeakMap();
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
  process.stderr.write(formatProgressLine(event));
}

function agentId(exec) {
  const preset = exec.agent?.session?.meta?.agentPreset;
  return typeof preset === "string" && preset ? preset : "supervisor";
}

function toolMessage(tool, phase) {
  const label = tool === "search_google_places"
    ? "Google Places search"
    : tool.replaceAll("_", " ");
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
