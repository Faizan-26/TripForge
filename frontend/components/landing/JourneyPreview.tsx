import styles from "@/app/page.module.css";

const moments = ["Slow mornings", "Local tables", "Open landscapes", "Time to wander"];

export function JourneyPreview() {
  return <div className={styles.journeyPreview} data-reveal>
    <div className={styles.previewTop}><span>Your trip, taking shape</span><span className={styles.previewStatus}>Curated around you</span></div>
    <div className={styles.previewBody}>
      <p className={styles.previewHeadline}>The details start finding each other.</p>
      <div className={styles.previewMap}>
        <svg viewBox="0 0 560 310" preserveAspectRatio="none" aria-hidden="true"><path d="M50 252 C118 180 150 89 240 128 S337 240 415 178 S477 103 520 66" /></svg>
        {moments.map((moment, index) => <span className={`${styles.previewMoment} ${styles[`moment${index + 1}`]}`} key={moment}>{moment}</span>)}
      </div>
    </div>
    <div className={styles.previewFoot}><span>Personal pace</span><span>Places with meaning</span><span>Thoughtful details</span></div>
  </div>;
}
