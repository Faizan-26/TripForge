import type { TripPlan } from "@/lib/trip-api/types";
import styles from "@/app/chat/new/chat.module.css";

function formatDistance(meters?: number | null) {
  if (meters == null) return null;
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(meters / 1000) + " km";
}

function formatDuration(seconds?: number | null) {
  if (seconds == null) return null;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours ? `${hours} hr ${minutes} min` : `${minutes} min`;
}

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}

export function TripPlanView({ plan }: { plan: TripPlan }) {
  const route = plan.trip_overview_route;
  const issues = [...plan.validation, ...plan.research_warnings.map((message) => ({
    code: message,
    message,
    severity: "warning" as const,
    retry_nodes: [],
    details: {},
  }))];

  return <section className={styles.plan} aria-labelledby="trip-plan-title">
    <header className={styles.planHeader}>
      <div><h2 id="trip-plan-title">{plan.requirements.destination}</h2><p>{plan.requirements.duration_days} days · {plan.requirements.travelers} traveler{plan.requirements.travelers === 1 ? "" : "s"} · {plan.requirements.pace} pace</p></div>
      {route?.google_maps_url && <a href={route.google_maps_url} target="_blank" rel="noreferrer">Open full route</a>}
    </header>

    {plan.selected_stay && <div className={styles.staySummary}>
      <span>Trip base</span>
      <div><strong>{plan.selected_stay.name}</strong><small>{plan.selected_stay.location.formatted_address ?? plan.selected_stay.location.label}</small></div>
      {plan.selected_stay.location.google_maps_uri && <a href={plan.selected_stay.location.google_maps_uri} target="_blank" rel="noreferrer">View map</a>}
    </div>}

    <div className={styles.itinerary}>
      {plan.itinerary.map((day) => <article className={styles.day} key={day.day}>
        <div className={styles.dayNumber}><span>Day</span><strong>{day.day}</strong></div>
        <div className={styles.dayBody}>
          <header><div><h3>{day.title}</h3>{day.date && <time dateTime={day.date}>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(`${day.date}T00:00:00`))}</time>}</div>
            {day.route?.google_maps_url && <a href={day.route.google_maps_url} target="_blank" rel="noreferrer">Daily route</a>}
          </header>
          <ol className={styles.stops}>
            {day.stops.map((stop) => <li key={`${day.day}-${stop.place.provider_id}`}>
              <span>{stop.sequence}</span>
              <div><strong>{stop.place.name}</strong><small>{stop.place.location.formatted_address ?? stop.place.location.label}</small></div>
              {stop.place.location.google_maps_uri && <a href={stop.place.location.google_maps_uri} target="_blank" rel="noreferrer" aria-label={`Open ${stop.place.name} in Google Maps`}>Map</a>}
            </li>)}
            {day.stops.length === 0 && <li className={styles.noStops}>No grounded stops were available for this day.</li>}
          </ol>
          {day.route && <p className={styles.routeMeta}>{[formatDistance(day.route.distance_meters), formatDuration(day.route.duration_seconds)].filter(Boolean).join(" · ")}</p>}
        </div>
      </article>)}
    </div>

    <section className={styles.budget}>
      <div><span>Known costs</span><strong>{formatMoney(plan.budget.known_cost_total, plan.budget.currency)}</strong></div>
      {plan.budget.budget_total != null && <div><span>Trip budget</span><strong>{formatMoney(plan.budget.budget_total, plan.budget.currency)}</strong></div>}
      <p>{plan.budget.coverage === "complete" ? "All planned costs are covered." : "Some live prices are unavailable; treat this as a planning estimate."}</p>
    </section>

    {issues.length > 0 && <details className={styles.planNotes}>
      <summary>{issues.length} planning note{issues.length === 1 ? "" : "s"}</summary>
      <ul>{issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul>
    </details>}
  </section>;
}
