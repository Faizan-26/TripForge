import type { GeneralAssistantResult } from "@/lib/trip-api/types";
import styles from "@/app/chat/new/chat.module.css";

function MapIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m9 18-6 3V6l6-3 6 3 6-3v15l-6 3-6-3Z" />
    <path d="M9 3v15M15 6v15" />
  </svg>;
}

export function TravelResponse({ response }: { response: GeneralAssistantResult }) {
  const presentation = response.presentation;
  if (!presentation) return <p>{response.message}</p>;

  return <section className={styles.travelResponse} aria-label={presentation.title}>
    <header className={styles.travelResponseHeader}>
      <h2>{presentation.title}</h2>
      {presentation.summary && <p>{presentation.summary}</p>}
    </header>

    {presentation.facts.length > 0 && <dl className={styles.travelFacts}>
      {presentation.facts.map((fact) => <div key={`${fact.label}-${fact.value}`}>
        <dt>{fact.label}</dt>
        <dd>{fact.value}</dd>
      </div>)}
    </dl>}

    <div className={styles.travelSections}>
      {presentation.sections.map((section) => <section key={section.title}>
        <header>
          <h3>{section.title}</h3>
          {section.subtitle && <p>{section.subtitle}</p>}
        </header>
        <ol>
          {section.items.map((item, index) => <li key={`${item.title}-${index}`}>
            <span className={styles.travelItemMarker}>{item.time ?? index + 1}</span>
            <div>
              <h4>{item.title}</h4>
              {item.description && <p>{item.description}</p>}
              {item.location && <small>{item.location}</small>}
            </div>
            {item.maps_url && <a href={item.maps_url} target="_blank" rel="noreferrer" aria-label={`Open ${item.title} in Google Maps`}>
              <MapIcon />
              <span>Map</span>
            </a>}
          </li>)}
        </ol>
      </section>)}
    </div>

    {presentation.notes.length > 0 && <details className={styles.travelNotes}>
      <summary>Planning notes</summary>
      <ul>{presentation.notes.map((note) => <li key={note}>{note}</li>)}</ul>
    </details>}
  </section>;
}
