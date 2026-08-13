"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClarificationForm } from "@/features/trip-planner/ClarificationForm";
import { PlanningProgress } from "@/features/trip-planner/PlanningProgress";
import { TripPlanView } from "@/features/trip-planner/TripPlanView";
import { HotelSearchResults } from "@/features/hotels/HotelSearchResults";
import { useTripPlanner } from "@/features/trip-planner/use-trip-planner";
import { clearTripDraft, TRIP_DRAFT_KEY } from "@/lib/auth/pending-auth";
import { useSessionStorage } from "@/lib/browser/use-session-storage";
import type { ConversationDetail, ConversationSummary } from "@/lib/trip-api/types";
import { deleteConversation, signOut } from "./actions";
import styles from "./chat.module.css";

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

function TrashIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4.75h6V7M7 7l.7 12h8.6L17 7M10 11v4.5M14 11v4.5" /></svg>;
}

function RouteMark() {
  return <svg className={styles.routeMark} viewBox="0 0 96 74" aria-hidden="true">
    <path d="M13 58c12-1 13-28 30-29 17-2 17 20 31 15 8-3 8-14 10-27" />
    <path d="m78 20 7-5 3 8" />
    <circle cx="13" cy="58" r="4" />
    <circle cx="43" cy="29" r="4" />
  </svg>;
}

function conversationDateLabel(conversation: ConversationSummary) {
  const date = new Date(conversation.last_message_at ?? conversation.created_at);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const daysAgo = Math.round((startOfToday.getTime() - startOfDate.getTime()) / 86_400_000);

  if (daysAgo === 0) return "Today";
  if (daysAgo === 1) return "Yesterday";

  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  }).format(date);
}

export function ChatWorkspace({
  email,
  initialConversation,
  initialConversations,
}: {
  email: string;
  initialConversation?: ConversationDetail;
  initialConversations: ConversationSummary[];
}) {
  const draft = useSessionStorage(TRIP_DRAFT_KEY);
  const router = useRouter();
  const initialized = useRef(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const [idea, setIdea] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [conversationToDelete, setConversationToDelete] = useState<ConversationSummary | null>(null);
  const [deletedConversationIds, setDeletedConversationIds] = useState<string[]>([]);
  const [deleteError, setDeleteError] = useState("");
  const [deletePending, startDeleteTransition] = useTransition();
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const {
    messages,
    conversationId,
    conversations,
    status,
    events,
    clarification,
    plan,
    hotelResult,
    error,
    busy,
    startRun,
    answerClarification,
    selectHotelAndPlan,
    reset,
  } = useTripPlanner(initialConversation, initialConversations);

  useEffect(() => {
    if (!draft || initialized.current) return;
    initialized.current = true;
    clearTripDraft();
    void startRun(draft);
  }, [draft, startRun]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, events, hotelResult, plan, error]);

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

  useEffect(() => {
    const dialog = deleteDialogRef.current;
    if (conversationToDelete && dialog && !dialog.open) dialog.showModal();
  }, [conversationToDelete]);

  const visibleConversations = conversations.filter((conversation) => !deletedConversationIds.includes(conversation.id));
  const conversationGroups = visibleConversations.reduce<Array<{ label: string; conversations: ConversationSummary[] }>>((groups, conversation) => {
    const label = conversationDateLabel(conversation);
    const currentGroup = groups.at(-1);
    if (currentGroup?.label === label) currentGroup.conversations.push(conversation);
    else groups.push({ label, conversations: [conversation] });
    return groups;
  }, []);

  function closeDeleteDialog() {
    if (deletePending) return;
    deleteDialogRef.current?.close();
    setConversationToDelete(null);
    setDeleteError("");
  }

  function confirmDeleteConversation() {
    if (!conversationToDelete) return;
    const deletedId = conversationToDelete.id;

    setDeleteError("");
    startDeleteTransition(async () => {
      try {
        const result = await deleteConversation(deletedId);
        if (result.error) {
          setDeleteError(result.error);
          return;
        }

        setDeletedConversationIds((ids) => [...ids, deletedId]);
        deleteDialogRef.current?.close();
        setConversationToDelete(null);
        if (deletedId === conversationId) router.push("/chat/new");
        else router.refresh();
      } catch {
        setDeleteError("We couldn't delete this conversation. Please try again.");
      }
    });
  }

  function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = idea.trim();
    if (!content) return;

    initialized.current = true;
    setIdea("");
    void startRun(content);
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
    reset();
    setIdea("");
    setSidebarOpen(false);
    router.push("/chat/new");
  }

  const initial = email === "Traveler" ? "T" : email.charAt(0).toUpperCase();
  const statusText = busy
    ? "TripForge is thinking"
    : status === "needs_clarification"
      ? "Waiting for your choices"
      : status === "completed"
        ? hotelResult ? "Hotels ready" : plan ? "Plan ready" : "Ready when you are"
        : status === "failed"
          ? "Needs attention"
          : "Ready when you are";

  return <main className={styles.page}>
    <button className={`${styles.scrim} ${sidebarOpen ? styles.scrimVisible : ""}`} type="button" aria-label="Close trip menu" onClick={() => setSidebarOpen(false)} />
    <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ""}`}>
      <div className={styles.sidebarTop}>
        <Link className={styles.brand} href="/" aria-label="TripForge home"><span>Trip</span>Forge</Link>
        <button className={styles.newTrip} type="button" onClick={startNewTrip}><PlusIcon /> New trip</button>
      </div>

      <section className={styles.tripLibrary} aria-labelledby="trips-heading">
        <h2 id="trips-heading">Your trips</h2>
        {conversationGroups.length > 0 ? <div className={styles.tripGroups}>{conversationGroups.map((group) => <section className={styles.tripGroup} key={group.label} aria-label={group.label}>
          <h3><span>{group.label}</span></h3>
          <ul>{group.conversations.map((conversation) => <li key={conversation.id}>
            <Link className={conversation.id === conversationId ? styles.tripActive : ""} href={`/chat/${conversation.id}`} onClick={() => setSidebarOpen(false)} aria-current={conversation.id === conversationId ? "page" : undefined}>
              <span>{conversation.title}</span>
            </Link>
            <button className={styles.deleteTrip} type="button" aria-label={`Delete ${conversation.title}`} onClick={() => { setDeleteError(""); setConversationToDelete(conversation); }}><TrashIcon /></button>
          </li>)}</ul>
        </section>)}</div> : <div className={styles.noTrips}><RouteMark /><p>No saved trips yet</p><small>Your conversations will appear here.</small></div>}
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

    <dialog className={styles.deleteDialog} ref={deleteDialogRef} onCancel={(event) => { event.preventDefault(); closeDeleteDialog(); }} onClose={() => { if (!deletePending) setConversationToDelete(null); }}>
      <div className={styles.deleteDialogIcon}><TrashIcon /></div>
      <h2>Delete conversation?</h2>
      <p><strong>{conversationToDelete?.title}</strong> will be removed from your trip history. This action can’t be undone.</p>
      {deleteError && <p className={styles.deleteError} role="alert">{deleteError}</p>}
      <div className={styles.deleteDialogActions}>
        <button type="button" onClick={closeDeleteDialog} disabled={deletePending}>Cancel</button>
        <button type="button" onClick={confirmDeleteConversation} disabled={deletePending}>{deletePending ? "Deleting…" : "Delete"}</button>
      </div>
    </dialog>

    <section className={styles.workspace}>
      <header className={styles.workspaceHeader}>
        <button className={styles.menuButton} type="button" onClick={() => setSidebarOpen(true)} aria-label="Open trip menu"><MenuIcon /></button>
        <div><strong>{conversations.find((item) => item.id === conversationId)?.title ?? plan?.requirements.destination ?? "New trip"}</strong><span><i className={busy ? styles.statusBusy : ""} /> {statusText}</span></div>
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
            <div>
              <span>{message.role === "traveler" ? "You" : "TripForge"}</span>
              <p>{message.content}</p>
              {message.artifact && "itinerary" in message.artifact && <TripPlanView plan={message.artifact} />}
              {message.artifact && "properties" in message.artifact && <HotelSearchResults result={message.artifact} disabled={busy} onSelect={selectHotelAndPlan} />}
            </div>
          </article>)}
          <PlanningProgress events={events} status={status} />
          {hotelResult && !messages.some((message) => message.artifact === hotelResult) && <HotelSearchResults result={hotelResult} disabled={busy} onSelect={selectHotelAndPlan} />}
          {plan && !messages.some((message) => message.artifact === plan) && <TripPlanView plan={plan} />}
          {error && <section className={styles.runError} role="alert"><strong>Planning paused</strong><p>{error}</p><button type="button" onClick={() => reset()}>Start again</button></section>}
          <div ref={threadEndRef} />
        </div>}
      </div>

      <div className={styles.composerWrap}>
        {clarification && <ClarificationForm clarification={clarification} disabled={busy} onSubmit={answerClarification} />}
        <form className={styles.composer} onSubmit={sendMessage}>
          <label htmlFor="trip-idea">Share your trip idea</label>
          <textarea id="trip-idea" value={idea} onChange={(event) => setIdea(event.target.value)} onKeyDown={handleComposerKeyDown} placeholder="A week in northern Pakistan with mountains, local food, and a relaxed pace…" rows={1} maxLength={6000} disabled={busy || Boolean(clarification)} />
          <button type="submit" aria-label="Send trip idea" disabled={!idea.trim() || busy || Boolean(clarification)}><ArrowIcon /></button>
        </form>
        <p>{clarification ? "Complete the questions to continue" : busy ? "TripForge is thinking" : "Enter to send · Shift + Enter for a new line"}</p>
      </div>
    </section>
  </main>;
}
