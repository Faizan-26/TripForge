"use client";

import { useMemo, useState } from "react";
import {
  PUBLIC_ACTIVITY_EVENT_TYPES,
  type RunEvent,
  type RunStatus,
} from "@/lib/trip-api/types";
import styles from "@/app/chat/new/chat.module.css";

const visibleTypes = new Set<string>(PUBLIC_ACTIVITY_EVENT_TYPES);

const agentLabels: Record<string, string> = {
  supervisor: "Trip planner",
  general: "Travel assistant",
  hotel_search: "Stay researcher",
  trip_scope: "Route designer",
  stay: "Stay researcher",
  activity: "Place researcher",
  travel_info: "Travel researcher",
  compatibility: "Route reviewer",
  itinerary: "Itinerary builder",
  budget: "Budget reviewer",
  validator: "Plan reviewer",
  stay_research: "Stay researcher",
  activity_research: "Place researcher",
  travel_research: "Travel researcher",
  compatibility_ranking: "Route reviewer",
  workflow: "Planning stage",
};

const goalLabels: Record<string, string> = {
  request_understanding: "Understanding your request",
  trip_requirements: "Trip requirements",
  hotel_selection: "Hotel selection",
  historical_places: "Historical-place research",
  itinerary: "Itinerary",
  complete: "Plan complete",
};

const toolLabels: Record<string, string> = {
  search_google_places: "Google Places",
  compute_google_route: "Google Routes",
};

type ActivityItem = {
  key: string;
  event: RunEvent;
  started?: RunEvent;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringData(event: RunEvent, key: string) {
  const value = event.data[key];
  return typeof value === "string" ? value : undefined;
}

function isInternalToolEvent(event: RunEvent) {
  return event.type.startsWith("tool.") && stringData(event, "tool") === "submit_trip_response";
}

function activityItems(events: RunEvent[]): ActivityItem[] {
  const result: ActivityItem[] = [];
  const tools = new Map<string, number>();
  const agents = new Map<string, number>();

  for (const event of events) {
    if (!visibleTypes.has(event.type) || isInternalToolEvent(event)) continue;
    if (event.type.startsWith("tool.")) {
      const callId = stringData(event, "call_id") ?? `${event.sequence}`;
      const existingIndex = tools.get(callId);
      if (existingIndex === undefined) {
        tools.set(callId, result.length);
        result.push({ key: `tool-${callId}`, event });
      } else {
        const previous = result[existingIndex];
        result[existingIndex] = {
          ...previous,
          event,
          started: previous.started ?? previous.event,
        };
      }
      continue;
    }
    if (["agent.started", "agent.progress", "agent.completed", "answer.preparing"].includes(event.type)) {
      const agentKey = event.agent ?? "supervisor";
      const existingIndex = agents.get(agentKey);
      if (existingIndex === undefined) {
        agents.set(agentKey, result.length);
        result.push({ key: `agent-${agentKey}`, event });
      } else {
        result[existingIndex] = { ...result[existingIndex], event };
      }
      continue;
    }
    if (["run.paused", "run.completed", "run.failed"].includes(event.type)) {
      const terminalIndex = result.findIndex((item) => item.key === "run-terminal");
      if (terminalIndex === -1) result.push({ key: "run-terminal", event });
      else result[terminalIndex] = { key: "run-terminal", event };
      continue;
    }
    result.push({ key: `${event.type}-${event.sequence}`, event });
  }

  return result.slice(-8);
}

function itemTitle(item: ActivityItem) {
  const { event } = item;
  const tool = stringData(event, "tool") ?? stringData(item.started ?? event, "tool");
  if (tool) return toolLabels[tool] ?? tool.replaceAll("_", " ");
  const goal = stringData(event, "goal");
  if (goal) return goalLabels[goal] ?? "Planning stage";
  if (event.type === "run.started") return "Request received";
  if (event.type === "run.completed") return "Response completed";
  if (event.type === "run.paused") return "Waiting for your choices";
  if (event.type === "run.failed") return "Planning stopped";
  if (event.type === "answer.preparing") return "Preparing your response";
  if (event.type === "agent.completed") return "Planning complete";
  return event.agent ? agentLabels[event.agent] ?? "Trip planner" : "Trip planner";
}

function itemDetail(item: ActivityItem) {
  const event = item.event;
  const source = item.started ?? event;
  const args = isRecord(source.data.arguments) ? source.data.arguments : undefined;
  const query = typeof args?.query === "string" ? args.query : undefined;
  const duration = typeof event.data.duration_ms === "number" ? event.data.duration_ms : undefined;
  const firstToken = typeof event.data.first_token_ms === "number" ? event.data.first_token_ms : undefined;
  const outputTokens = typeof event.data.output_tokens === "number" ? event.data.output_tokens : undefined;
  const goal = stringData(event, "goal");
  const goalStatus = stringData(event, "goal_status");
  if (goal) {
    if (goalStatus === "completed") return "This planning stage is complete.";
    if (goalStatus === "skipped") return "This stage is not needed for your trip.";
    if (goalStatus === "blocked") return "This stage needs another choice before continuing.";
    return event.message;
  }
  if (event.type === "tool.failed") return stringData(event, "error") ?? "The tool could not finish.";
  if (query && duration !== undefined) return `Searched “${query}” · ${formatDuration(duration)}`;
  if (query) return `Searching for “${query}”`;
  if (event.type === "agent.completed" && duration !== undefined) {
    return [
      `Completed in ${formatDuration(duration)}`,
      firstToken !== undefined ? `first response ${formatDuration(firstToken)}` : undefined,
      outputTokens !== undefined ? `${outputTokens.toLocaleString()} output tokens` : undefined,
    ].filter(Boolean).join(" · ");
  }
  if (duration !== undefined) return `Completed in ${formatDuration(duration)}`;
  return event.message;
}

function itemState(event: RunEvent, busy: boolean) {
  const goalStatus = stringData(event, "goal_status");
  if (goalStatus === "blocked") return "failed";
  if (goalStatus === "completed" || goalStatus === "skipped") return "completed";
  if (goalStatus === "in_progress" && !busy) return "paused";
  if (event.type === "tool.failed" || event.type === "run.failed") return "failed";
  if (event.type === "tool.completed" || event.type === "agent.completed" || event.type === "run.completed") return "completed";
  if (event.type === "run.paused") return "paused";
  return busy ? "active" : "completed";
}

function formatDuration(milliseconds: number) {
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  return `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`;
}

function totalToolTime(events: RunEvent[]) {
  return events.reduce((total, event) => (
    event.type.startsWith("tool.")
      && !isInternalToolEvent(event)
      && typeof event.data.duration_ms === "number"
      ? total + event.data.duration_ms
      : total
  ), 0);
}

function StatusGlyph({ state }: { state: string }) {
  if (state === "completed") {
    return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 8.2 2.4 2.4L12 5" /></svg>;
  }
  if (state === "failed") {
    return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 5 6 6m0-6-6 6" /></svg>;
  }
  if (state === "paused") {
    return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4v8m4-8v8" /></svg>;
  }
  return <span aria-hidden="true" />;
}

export function PlanningProgress({ events, status }: { events: RunEvent[]; status?: RunStatus }) {
  const busy = status === "queued" || status === "running";
  const [expanded, setExpanded] = useState(true);
  const items = useMemo(() => activityItems(events), [events]);

  if (items.length === 0) return null;

  const toolCount = new Set(events.flatMap((event) => {
    const callId = stringData(event, "call_id");
    return event.type.startsWith("tool.") && !isInternalToolEvent(event) && callId ? [callId] : [];
  })).size;
  const duration = totalToolTime(events);
  const latest = [...events].reverse().find((event) => (
    visibleTypes.has(event.type) && !isInternalToolEvent(event)
  ))?.message
    ?? "Planning your trip";
  const heading = busy ? "Planning your trip" : "How this response was built";

  return <article className={styles.activityMessage} aria-label={heading}>
    <span className={styles.assistantMark}>TF</span>
    <div className={styles.activityCard}>
      <button
        className={styles.activityToggle}
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span>
          <strong>{heading}</strong>
          <small aria-live="polite">{busy
            ? latest
            : toolCount > 0
              ? `${toolCount} source ${toolCount === 1 ? "check" : "checks"}${duration ? ` · ${formatDuration(duration)}` : ""}`
              : "No external lookups"}</small>
        </span>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
      </button>

      {expanded && <ol className={styles.activityTimeline}>
        {items.map((item) => {
          const state = itemState(item.event, busy);
          return <li className={styles[`activity_${state}`]} key={item.key}>
            <span className={styles.activityGlyph}><StatusGlyph state={state} /></span>
            <span>
              <strong>{itemTitle(item)}</strong>
              <small>{itemDetail(item)}</small>
            </span>
          </li>;
        })}
      </ol>}
    </div>
  </article>;
}
