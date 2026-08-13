"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthEmailOtpForm } from "@/components/auth/AuthEmailOtpForm";
import { DetailsSection } from "@/components/landing/DetailsSection";
import { ItineraryProgress } from "@/components/landing/ItineraryProgress";
import { JourneyPreview } from "@/components/landing/JourneyPreview";
import { ArrowIcon, PlaneIcon, ShieldIcon } from "@/components/landing/icons";
import { saveTripDraft } from "@/lib/auth/pending-auth";
import { createClient } from "@/lib/supabase/client";
import styles from "./page.module.css";

export default function Home() {
  const router = useRouter();
  const [tripRequest, setTripRequest] = useState("");
  const [authOpen, setAuthOpen] = useState(false);
  const [tripError, setTripError] = useState("");
  const [isCheckingAuth, setIsCheckingAuth] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState<boolean | null>(null);
  const pageRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    void supabase.auth.getClaims().then(({ data }) => {
      if (active) setIsSignedIn(Boolean(data?.claims?.sub));
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setIsSignedIn(Boolean(session?.user));
    });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const elements = pageRef.current?.querySelectorAll<HTMLElement>("[data-reveal]");
    if (!elements?.length || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => entry.isIntersecting && entry.target.classList.add(styles.isVisible)), { threshold: 0.16 });
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  async function openAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tripRequest.trim()) { setTripError("Tell us a little about the trip you have in mind first."); return; }
    if (isCheckingAuth) return;
    setIsCheckingAuth(true);
    saveTripDraft(tripRequest);
    setTripError("");
    const supabase = createClient();
    const { data } = await supabase.auth.getClaims();
    if (data?.claims?.sub) {
      router.push("/chat/new");
      return;
    }
    setIsCheckingAuth(false);
    setAuthOpen(true);
  }

  return <main className={styles.page} ref={pageRef}>
    <nav className={styles.nav} aria-label="Main navigation"><a className={styles.brand} href="#top" aria-label="TripForge home"><span>Trip</span>Forge</a><div className={styles.navLinks}><a href="#how-it-works">How it works</a><a href="#why-tripforge">Why TripForge</a></div><button className={`${styles.signIn} ${isSignedIn === null ? styles.authPending : ""}`} type="button" aria-hidden={isSignedIn === null} tabIndex={isSignedIn === null ? -1 : 0} onClick={() => isSignedIn ? router.push("/chat/new") : setAuthOpen(true)}>{isSignedIn ? "Plan your trip" : "Sign in"}</button></nav>
    <section className={styles.hero} id="top">
      <div className={styles.heroCopy} data-reveal><h1>Travel, thoughtfully assembled.</h1><p className={styles.intro}>One idea in. A considered route out.</p><form className={styles.tripForm} onSubmit={openAuth}><label htmlFor="trip-request">Where would you like to go?</label><div className={styles.inputRow}><PlaneIcon /><input id="trip-request" value={tripRequest} onChange={(event) => setTripRequest(event.target.value)} placeholder="7 days in Pakistan for two, with mountains and great food" /><button type="submit" aria-label={isCheckingAuth ? "Checking sign-in" : "Start planning"} disabled={isCheckingAuth}><ArrowIcon /></button></div>{tripError && !authOpen && <p className={styles.formMessage} role="alert">{tripError}</p>}</form><p className={styles.hint}>A destination, a feeling, or a half-formed idea is enough.</p></div>
      <JourneyPreview />
    </section>
    <ItineraryProgress />
    <DetailsSection />
    <section className={styles.proof} id="why-tripforge"><div className={styles.proofMap} data-reveal><div className={styles.proofLine} /><p>One route. Every decision connected.</p></div><div className={styles.proofCopy} data-reveal><ShieldIcon /><h2>Made to hold together.</h2><p>Time, distance, budget, and all the in-between.</p></div></section>
    <section className={styles.close} data-reveal><p>Your next route starts here.</p><h2>Bring the first thought.</h2><button type="button" onClick={() => document.getElementById("trip-request")?.focus()}>Start planning <ArrowIcon /></button></section>
    {authOpen && <AuthEmailOtpForm onClose={() => setAuthOpen(false)} next="/chat/new" />}
  </main>;
}
