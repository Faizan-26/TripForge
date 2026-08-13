"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createTripRun,
  getTripRun,
  streamTripRun,
  userFacingTripError,
} from "@/lib/trip-api/client";
import {
  isClarificationResult,
  isTripPlan,
  type AnswerValue,
  type ClarificationResult,
  type RunEvent,
  type RunStatus,
  type TripPlan,
} from "@/lib/trip-api/types";

export type ThreadMessage = {
  id: string;
  role: "traveler" | "assistant";
  content: string;
};

function id() {
  return crypto.randomUUID();
}

export function useTripPlanner() {
  const abortRef = useRef<AbortController | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [conversationId, setConversationId] = useState<string>();
  const [runId, setRunId] = useState<string>();
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<RunStatus>();
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [clarification, setClarification] = useState<ClarificationResult>();
  const [plan, setPlan] = useState<TripPlan>();
  const [error, setError] = useState("");

  const busy = status === "queued" || status === "running";

  const startRun = useCallback(
    async (
      message: string,
      options: { answers?: Record<string, AnswerValue>; parentRunId?: string } = {},
    ) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setError("");
      setClarification(undefined);
      setPlan(undefined);
      setEvents([]);
      setStatus("queued");

      if (!options.parentRunId) {
        setPrompt(message);
        setMessages((current) => [
          ...current,
          { id: id(), role: "traveler", content: message },
        ]);
      } else {
        setMessages((current) => [
          ...current,
          { id: id(), role: "traveler", content: "I’ve added the missing trip details." },
        ]);
      }

      try {
        const created = await createTripRun(
          {
            message,
            conversation_id: conversationId,
            client_request_id: id(),
            client_message_id: id(),
            answers: options.answers,
            parent_run_id: options.parentRunId,
          },
          controller.signal,
        );
        setConversationId(created.conversation_id);
        setRunId(created.run_id);
        setStatus(created.status);

        await streamTripRun(
          created.run_id,
          (event) => {
            setEvents((current) => {
              if (current.some((item) => item.sequence === event.sequence)) return current;
              return [...current, event];
            });
            if (event.type === "run.started") setStatus("running");
            if (event.type === "run.failed") setStatus("failed");
          },
          controller.signal,
        );

        const snapshot = await getTripRun(created.run_id, controller.signal);
        setStatus(snapshot.status);
        if (isClarificationResult(snapshot.result)) {
          setClarification(snapshot.result);
          setMessages((current) => [
            ...current,
            { id: id(), role: "assistant", content: "A few choices will help me plan this properly." },
          ]);
        } else if (isTripPlan(snapshot.result)) {
          setPlan(snapshot.result);
          setMessages((current) => [
            ...current,
            { id: id(), role: "assistant", content: "Your route is ready. Here’s the complete plan." },
          ]);
        } else if (snapshot.error) {
          setError(snapshot.error);
        }
      } catch (caught) {
        if (controller.signal.aborted) return;
        setStatus("failed");
        setError(userFacingTripError(caught));
      }
    },
    [conversationId],
  );

  const answerClarification = useCallback(
    (answers: Record<string, AnswerValue>) => {
      if (!runId || !prompt) return Promise.resolve();
      return startRun(prompt, { answers, parentRunId: runId });
    },
    [prompt, runId, startRun],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setConversationId(undefined);
    setRunId(undefined);
    setPrompt("");
    setStatus(undefined);
    setEvents([]);
    setClarification(undefined);
    setPlan(undefined);
    setError("");
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  return {
    messages,
    status,
    events,
    clarification,
    plan,
    error,
    busy,
    startRun,
    answerClarification,
    reset,
  };
}
