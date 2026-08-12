import styles from "@/app/page.module.css";
import { CalendarIcon, CompassIcon, PinIcon, SparkIcon } from "./icons";

const milestones = [
  { label: "Share a thought", Icon: SparkIcon },
  { label: "Find your rhythm", Icon: CompassIcon },
  { label: "Discover the places", Icon: PinIcon },
  { label: "See your days", Icon: CalendarIcon },
];

export function ItineraryProgress() {
  return <section className={styles.itinerary} aria-label="From idea to itinerary" data-reveal>
    <p>From idea to itinerary</p>
    <div className={styles.itineraryTrack}>
      <div className={styles.itineraryLine} aria-hidden="true" />
      {milestones.map(({ label, Icon }) => <div className={styles.itineraryStop} key={label}><span><Icon /></span><strong>{label}</strong></div>)}
    </div>
  </section>;
}
