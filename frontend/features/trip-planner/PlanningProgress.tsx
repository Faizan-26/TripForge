import type { RunEvent, RunStatus } from "@/lib/trip-api/types";
import styles from "@/app/chat/new/chat.module.css";

const agentLabels: Record<string, string> = {
  supervisor: "Understanding your request",
  trip_scope: "Shaping the route",
  stay: "Researching stays",
  activity: "Finding places",
  travel_info: "Checking travel context",
  compatibility: "Balancing distance and pace",
  itinerary: "Building each day",
  budget: "Checking the budget",
  validator: "Reviewing the final plan",
};

export function PlanningProgress({ events, status }: { events: RunEvent[]; status?: RunStatus }) {
  const latestByAgent = new Map<string, RunEvent>();
  for (const event of events) {
    if (event.agent) latestByAgent.set(event.agent, event);
  }

  if (!status || !["queued", "running"].includes(status)) return null;

  return <section className={styles.progressPanel} aria-label="Trip planning progress" aria-live="polite">
    <div className={styles.progressHeading}>
      <span className={styles.liveDot} />
      <div><strong>Planning your route</strong><small>Specialists are working in parallel</small></div>
    </div>
    <ol className={styles.agentProgress}>
      {[...latestByAgent.entries()].map(([agent, event]) => <li key={agent}>
        <span className={event.type === "agent.completed" ? styles.agentDone : styles.agentActive} />
        <div><strong>{agentLabels[agent] ?? agent.replaceAll("_", " ")}</strong><small>{event.message}</small></div>
      </li>)}
      {latestByAgent.size === 0 && <li><span className={styles.agentActive} /><div><strong>Preparing the planning desk</strong><small>Your request is queued</small></div></li>}
    </ol>
  </section>;
}
