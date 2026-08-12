"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { clearTripDraft, saveTripDraft, TRIP_DRAFT_KEY } from "@/lib/auth/pending-auth";
import { useSessionStorage } from "@/lib/browser/use-session-storage";
import { signOut } from "./actions";
import styles from "./chat.module.css";

type Message = {
  id: number;
  role: "traveler" | "assistant";
  content: string;
};

type Project = {
  id: string;
  title: string;
};

const projects: Project[] = [];

function MenuIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
}

function PlusIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;
}

function ArrowIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 17 10-10M8 7h9v9" /></svg>;
}

function UserIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M5.5 19c.8-3.2 3-5 6.5-5s5.7 1.8 6.5 5" /></svg>;
}

function SignOutIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19H10M14 8l4 4-4 4M9 12h9" /></svg>;
}

function ChevronIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 14 4-4 4 4" /></svg>;
}

function RouteMark() {
  return <svg className={styles.routeMark} viewBox="0 0 96 74" aria-hidden="true">
    <path d="M13 58c12-1 13-28 30-29 17-2 17 20 31 15 8-3 8-14 10-27" />
    <path d="m78 20 7-5 3 8" />
    <circle cx="13" cy="58" r="4" />
    <circle cx="43" cy="29" r="4" />
  </svg>;
}

function buildAssistantReply(messageCount: number) {
  return messageCount === 0
    ? "I’ve got the idea. Add anything else that should shape the route—dates, budget, pace, or a must-do."
    : "Added. Tell me anything else you want this trip to make room for.";
}

export function ChatWorkspace({ email }: { email: string }) {
  const draft = useSessionStorage(TRIP_DRAFT_KEY);
  const initialized = useRef(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [idea, setIdea] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  useEffect(() => {
    if (!draft || initialized.current) return;
    initialized.current = true;
    setMessages([
      { id: 1, role: "traveler", content: draft },
      { id: 2, role: "assistant", content: buildAssistantReply(0) },
    ]);
  }, [draft]);

  useEffect(() => {
    if (!accountMenuOpen) return;

    function closeOnOutsideClick(event: PointerEvent) {
      if (!accountMenuRef.current?.contains(event.target as Node)) setAccountMenuOpen(false);
    }

    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setAccountMenuOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [accountMenuOpen]);

  function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = idea.trim();
    if (!content) return;

    initialized.current = true;
    saveTripDraft(content);
    setMessages((current) => [
      ...current,
      { id: Date.now(), role: "traveler", content },
      { id: Date.now() + 1, role: "assistant", content: buildAssistantReply(current.length) },
    ]);
    setIdea("");
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function startNewTrip() {
    initialized.current = true;
    clearTripDraft();
    setMessages([]);
    setIdea("");
    setSidebarOpen(false);
  }

  const initial = email === "Traveler" ? "T" : email.charAt(0).toUpperCase();

  return <main className={styles.page}>
    <button className={`${styles.scrim} ${sidebarOpen ? styles.scrimVisible : ""}`} type="button" aria-label="Close trip menu" onClick={() => setSidebarOpen(false)} />
    <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ""}`}>
      <div className={styles.sidebarTop}>
        <Link className={styles.brand} href="/" aria-label="TripForge home"><span>Trip</span>Forge</Link>
        <button className={styles.newTrip} type="button" onClick={startNewTrip}><PlusIcon /> New trip</button>
      </div>

      <section className={styles.tripLibrary} aria-labelledby="trips-heading">
        <h2 id="trips-heading">Your trips</h2>
        {projects.length > 0 ? <ul>{projects.map((project) => <li key={project.id}><button type="button">{project.title}</button></li>)}</ul> : <div className={styles.noTrips}><RouteMark /><p>No saved trips yet</p><small>Your conversations will appear here.</small></div>}
      </section>

      <div className={styles.account} ref={accountMenuRef}>
        {accountMenuOpen && <div className={styles.accountMenu} id="account-menu" role="dialog" aria-label="Account menu">
          <div className={styles.accountDetails}>
            <span className={styles.menuIcon}><UserIcon /></span>
            <span><strong>{email === "Traveler" ? email : email.split("@")[0]}</strong><small>{email === "Traveler" ? "Signed in" : email}</small></span>
          </div>
          <form action={signOut}>
            <button type="submit"><SignOutIcon />Sign out</button>
          </form>
        </div>}
        <button className={styles.accountTrigger} type="button" aria-expanded={accountMenuOpen} aria-controls="account-menu" onClick={() => setAccountMenuOpen((open) => !open)}>
          <span className={styles.avatar}>{initial}</span>
          <span className={styles.accountText}><strong>{email === "Traveler" ? email : email.split("@")[0]}</strong><small>Account</small></span>
          <span className={`${styles.chevron} ${accountMenuOpen ? styles.chevronOpen : ""}`}><ChevronIcon /></span>
        </button>
      </div>
    </aside>

    <section className={styles.workspace}>
      <header className={styles.workspaceHeader}>
        <button className={styles.menuButton} type="button" onClick={() => setSidebarOpen(true)} aria-label="Open trip menu"><MenuIcon /></button>
        <div><strong>New trip</strong><span><i /> Ready when you are</span></div>
      </header>

      <div className={`${styles.thread} ${messages.length === 0 ? styles.threadEmpty : ""}`}>
        {messages.length === 0 ? <div className={styles.welcome}>
          <RouteMark />
          <h1>Where should we go?</h1>
          <p>Share a destination, a feeling, or the rough shape of a trip.</p>
          <div className={styles.suggestions} aria-label="Trip idea suggestions">
            <button type="button" onClick={() => setIdea("A quiet week near the sea with great local food")}>Quiet coast</button>
            <button type="button" onClick={() => setIdea("A mountain trip with scenic trains and easy hikes")}>Mountain air</button>
            <button type="button" onClick={() => setIdea("A culture-filled city break without rushing")}>City and culture</button>
          </div>
        </div> : <div className={styles.messages} aria-live="polite">
          {messages.map((message) => <article className={message.role === "traveler" ? styles.travelerMessage : styles.assistantMessage} key={message.id}>
            {message.role === "assistant" && <span className={styles.assistantMark}>TF</span>}
            <div><span>{message.role === "traveler" ? "You" : "TripForge"}</span><p>{message.content}</p></div>
          </article>)}
        </div>}
      </div>

      <div className={styles.composerWrap}>
        <form className={styles.composer} onSubmit={sendMessage}>
          <label htmlFor="trip-idea">Share your trip idea</label>
          <textarea id="trip-idea" value={idea} onChange={(event) => setIdea(event.target.value)} onKeyDown={handleComposerKeyDown} placeholder="A week in northern Pakistan with mountains, local food, and a relaxed pace…" rows={1} />
          <button type="submit" aria-label="Send trip idea" disabled={!idea.trim()}><ArrowIcon /></button>
        </form>
        <p>Enter to send · Shift + Enter for a new line</p>
      </div>
    </section>
  </main>;
}
