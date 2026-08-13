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
  type ConversationDetail,
  type ConversationSummary,
  type RunEvent,
  type RunStatus,
  type TripPlan,
} from "@/lib/trip-api/types";

export type ThreadMessage = {
  id: string;
  role: "traveler" | "assistant";
  content: string;
  artifact?: TripPlan | ClarificationResult;
};

function id() {
  return crypto.randomUUID();
}

function hydrateConversation(detail?: ConversationDetail) {
  if (!detail) return {
    messages: [] as ThreadMessage[],
    runId: undefined,
    prompt: "",
    status: undefined,
    plan: undefined,
    clarification: undefined,
    error: "",
  };
  const artifacts = new Map(
    detail.artifacts
      .filter((artifact) => artifact.run_id)
      .map((artifact) => [artifact.run_id as string, artifact.payload]),
  );
  const latestArtifact = [...detail.artifacts].reverse().find((artifact) => artifact.is_current)
    ?? detail.artifacts.at(-1);
  const latestRun = detail.runs.at(-1);
  const latestPayload = latestArtifact?.payload;

  return {
    messages: detail.messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message): ThreadMessage => {
        const answers = message.metadata.answers;
        const runId = typeof message.metadata.run_id === "string" ? message.metadata.run_id : undefined;
        const artifact = runId ? artifacts.get(runId) : undefined;
        return {
          id: message.public_id,
          role: message.role === "user" ? "traveler" : "assistant",
          content: message.role === "user" && answers && typeof answers === "object" && Object.keys(answers).length
            ? "I’ve added the missing trip details."
            : message.content,
          artifact: isTripPlan(artifact)
            ? artifact
            : isClarificationResult(artifact)
              ? artifact
              : undefined,
        };
      }),
    runId: latestRun?.id,
    prompt: detail.messages.find((message) => message.role === "user")?.content ?? "",
    status: latestRun?.status,
    plan: isTripPlan(latestPayload) ? latestPayload : undefined,
    clarification: isClarificationResult(latestPayload) ? latestPayload : undefined,
    error: latestRun?.error_message ?? "",
  };
}

export function useTripPlanner(
  initialConversation?: ConversationDetail,
  initialConversations: ConversationSummary[] = [],
) {
  const abortRef = useRef<AbortController | null>(null);
  const [initial] = useState(() => hydrateConversation(initialConversation));
  const [messages, setMessages] = useState<ThreadMessage[]>(initial.messages);
  const [conversationId, setConversationId] = useState<string | undefined>(initialConversation?.conversation.id);
  const [runId, setRunId] = useState<string | undefined>(initial.runId);
  const [prompt, setPrompt] = useState(initial.prompt);
  const [status, setStatus] = useState<RunStatus | undefined>(initial.status);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [clarification, setClarification] = useState<ClarificationResult | undefined>(initial.clarification);
  const [plan, setPlan] = useState<TripPlan | undefined>(initial.plan);
  const [error, setError] = useState(initial.error);
  const [conversations, setConversations] = useState<ConversationSummary[]>(initialConversations);

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
        window.history.replaceState(null, "", `/chat/${created.conversation_id}`);
        setConversations((current) => current.some((item) => item.id === created.conversation_id)
          ? current
          : [{
              id: created.conversation_id,
              title: message.slice(0, 120),
              status: "active",
              last_message_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }, ...current]);
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
    conversationId,
    conversations,
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
