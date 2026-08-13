import type {
  CreateRunResponse,
  PlanTripRequest,
  RunEvent,
  RunSnapshot,
} from "./types";

export class TripApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TripApiError";
  }
}

async function apiError(response: Response) {
  let message = "TripForge could not complete that request.";
  try {
    const payload = (await response.json()) as {
      detail?: string | Array<{ msg?: string }>;
    };
    if (typeof payload.detail === "string") message = payload.detail;
    else if (Array.isArray(payload.detail)) {
      message = payload.detail.map((item) => item.msg).filter(Boolean).join(" ") || message;
    }
  } catch {
    // The fallback is intentionally user-safe when an upstream returns non-JSON.
  }
  return new TripApiError(message, response.status);
}

export async function createTripRun(
  payload: PlanTripRequest,
  signal?: AbortSignal,
): Promise<CreateRunResponse> {
  const response = await fetch("/api/trip-runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw await apiError(response);
  return response.json() as Promise<CreateRunResponse>;
}

export async function getTripRun(runId: string, signal?: AbortSignal): Promise<RunSnapshot> {
  const response = await fetch(`/api/trip-runs/${encodeURIComponent(runId)}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw await apiError(response);
  return response.json() as Promise<RunSnapshot>;
}

type EventHandler = (event: RunEvent) => void | Promise<void>;

export async function streamTripRun(
  runId: string,
  onEvent: EventHandler,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`/api/trip-runs/${encodeURIComponent(runId)}/events`, {
    cache: "no-store",
    headers: { Accept: "text/event-stream" },
    signal,
  });
  if (!response.ok) throw await apiError(response);
  if (!response.body) throw new TripApiError("The planning stream was unavailable.", 502);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const terminalEvents = new Set(["run.completed", "run.paused", "run.failed"]);

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replaceAll("\r\n", "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) {
        const event = JSON.parse(data) as RunEvent;
        await onEvent(event);
        if (terminalEvents.has(event.type)) {
          await reader.cancel();
          return;
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
    if (done) break;
  }
}

export function userFacingTripError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") return "";
  if (error instanceof TripApiError) {
    if (error.status === 401) return "Your session expired. Sign in again to continue.";
    if (error.status === 429) return "Planning is busy right now. Wait a moment and try again.";
    if (error.status >= 500) return "The planning service is temporarily unavailable. Try again.";
    return error.message;
  }
  return "We lost contact with the planning service. Check your connection and try again.";
}
