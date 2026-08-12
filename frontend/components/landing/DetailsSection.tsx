import styles from "@/app/page.module.css";
import { CalendarIcon, CompassIcon, PinIcon, SunIcon } from "./icons";

const details = [
  { title: "Your pace", copy: "Days with room to enjoy them.", Icon: CompassIcon },
  { title: "The right places", copy: "Stops that feel worth the detour.", Icon: PinIcon },
  { title: "The good moments", copy: "Food, views, and time to linger.", Icon: SunIcon },
  { title: "A plan to trust", copy: "Every day ready when you are.", Icon: CalendarIcon },
];

export function DetailsSection() {
  return <section className={styles.explainer} id="how-it-works">
    <div className={styles.sectionLead} data-reveal><h2>Each detail finds its place.</h2></div>
    <div className={styles.steps}>
      {details.map(({ title, copy, Icon }) => <article key={title} data-reveal><span className={styles.stepIcon}><Icon /></span><h3>{title}</h3><p>{copy}</p></article>)}
    </div>
  </section>;
}
