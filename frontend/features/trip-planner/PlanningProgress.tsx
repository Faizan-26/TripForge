import type { RunEvent, RunStatus } from "@/lib/trip-api/types";
import styles from "@/app/chat/new/chat.module.css";

const thinkingLabels: Record<string, string> = {
  supervisor: "Understanding your message",
  general: "Thinking about your question",
  hotel_search: "Looking for matching stays",
  trip_scope: "Shaping a sensible route",
  stay: "Researching where to stay",
  activity: "Finding useful places",
  travel_info: "Checking travel context",
  compatibility: "Balancing distance and pace",
  itinerary: "Building each day",
  budget: "Checking the budget",
  validator: "Reviewing the final plan",
  stay_research: "Researching where to stay",
  activity_research: "Finding useful places",
  travel_research: "Checking travel context",
  compatibility_ranking: "Balancing distance and pace",
};

export function PlanningProgress({ events, status }: { events: RunEvent[]; status?: RunStatus }) {
  if (!status || !["queued", "running"].includes(status)) return null;
  const latest = [...events].reverse().find((event) => event.agent);
  const label = latest?.agent ? thinkingLabels[latest.agent] ?? latest.message : "Reading your message";

  return <article className={styles.thinkingMessage} aria-label="TripForge is thinking" aria-live="polite">
    <span className={styles.assistantMark}>TF</span>
    <div>
      <span>TripForge</span>
      <p>{label}<i><b /><b /><b /></i></p>
    </div>
  </article>;
}
