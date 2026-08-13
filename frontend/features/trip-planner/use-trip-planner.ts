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
  isHotelSearchResult,
  isGeneralAssistantResult,
  isTripPlan,
  type AnswerValue,
  type ClarificationResult,
  type ConversationDetail,
  type ConversationSummary,
  type HotelPropertyCandidate,
  type HotelSearchResult,
  type RunEvent,
  type RunStatus,
  type SelectedHotelContext,
  type TripPlan,
} from "@/lib/trip-api/types";

export type ThreadMessage = {
  id: string;
  role: "traveler" | "assistant";
  content: string;
  artifact?: TripPlan | ClarificationResult | HotelSearchResult;
};

type StartRunOptions = {
  answers?: Record<string, AnswerValue>;
  parentRunId?: string;
  intent?: "GENERAL" | "FULL_TRIP_PLAN" | "HOTEL_SEARCH";
  selectedHotel?: SelectedHotelContext;
  followUpLabel?: string;
};

function id() {
  return crypto.randomUUID();
}

function selectedHotelFromClarification(
  clarification?: ClarificationResult,
): SelectedHotelContext | undefined {
  const selected = clarification?.draft?.selected_hotel;
  if (!selected || typeof selected !== "object") return undefined;
  return selected as SelectedHotelContext;
}

function hydrateConversation(detail?: ConversationDetail) {
  if (!detail) return {
    messages: [] as ThreadMessage[],
    runId: undefined,
    prompt: "",
    status: undefined,
    plan: undefined,
    hotelResult: undefined,
    clarification: undefined,
    selectedHotel: undefined,
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
            : isHotelSearchResult(artifact)
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
    hotelResult: isHotelSearchResult(latestPayload) ? latestPayload : undefined,
    clarification: isClarificationResult(latestPayload) ? latestPayload : undefined,
    selectedHotel: isClarificationResult(latestPayload)
      ? selectedHotelFromClarification(latestPayload)
      : undefined,
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
  const [hotelResult, setHotelResult] = useState<HotelSearchResult | undefined>(initial.hotelResult);
  const [selectedHotel, setSelectedHotel] = useState<SelectedHotelContext | undefined>(initial.selectedHotel);
  const [error, setError] = useState(initial.error);
  const [conversations, setConversations] = useState<ConversationSummary[]>(initialConversations);

  const busy = status === "queued" || status === "running";

  const startRun = useCallback(
    async (message: string, options: StartRunOptions = {}) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setError("");
      setClarification(undefined);
      setPlan(undefined);
      setHotelResult(undefined);
      setEvents([]);
      setStatus("queued");

      if (!options.parentRunId) {
        setPrompt(message);
        setMessages((current) => [
          ...current,
          { id: id(), role: "traveler", content: message },
        ]);
      } else {
        if (options.intent === "FULL_TRIP_PLAN" && options.selectedHotel) {
          setPrompt(message);
        }
        setMessages((current) => [
          ...current,
          {
            id: id(),
            role: "traveler",
            content: options.followUpLabel ?? "I’ve added the missing trip details.",
          },
        ]);
      }

      try {
        const context = messages.slice(-10).map((item) => ({
          role: item.role === "traveler" ? "user" as const : "assistant" as const,
          content: item.content,
        }));
        const created = await createTripRun(
          {
            message,
            conversation_id: conversationId,
            client_request_id: id(),
            client_message_id: id(),
            answers: options.answers,
            parent_run_id: options.parentRunId,
            intent: options.intent,
            selected_hotel: options.selectedHotel,
            context,
          },
          controller.signal,
        );
        setConversationId(created.conversation_id);
        window.history.replaceState(null, "", `/chat/${created.conversation_id}`);
        setConversations((current) => current.some((item) => item.id === created.conversation_id)
          ? current
          : [{
              id: created.conversation_id,
              title: "New conversation",
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
            if (event.type === "run.paused") setStatus("needs_clarification");
            if (event.type === "run.completed") setStatus("completed");
            if (event.type === "run.failed") setStatus("failed");
            const generatedTitle = event.data.conversation_title;
            if (typeof generatedTitle === "string" && generatedTitle.trim()) {
              setConversations((current) => current.map((item) =>
                item.id === created.conversation_id
                && ["New conversation", "New trip"].includes(item.title)
                  ? { ...item, title: generatedTitle }
                  : item));
            }
          },
          controller.signal,
        );

        const snapshot = await getTripRun(created.run_id, controller.signal);
        setStatus(snapshot.status);
        if (isGeneralAssistantResult(snapshot.result)) {
          const result = snapshot.result;
          setMessages((current) => [
            ...current,
            { id: id(), role: "assistant", content: result.message },
          ]);
        } else if (isClarificationResult(snapshot.result)) {
          setClarification(snapshot.result);
          setSelectedHotel(
            options.selectedHotel ?? selectedHotelFromClarification(snapshot.result),
          );
          setMessages((current) => [
            ...current,
            { id: id(), role: "assistant", content: "A few choices will help me plan this properly." },
          ]);
        } else if (isTripPlan(snapshot.result)) {
          setPlan(snapshot.result);
          setSelectedHotel(undefined);
          setMessages((current) => [
            ...current,
            { id: id(), role: "assistant", content: "Your route is ready. Here’s the complete plan." },
          ]);
        } else if (isHotelSearchResult(snapshot.result)) {
          const result = snapshot.result;
          setHotelResult(result);
          setMessages((current) => [
            ...current,
            {
              id: id(),
              role: "assistant",
              content: "I found grounded properties to compare. Choose one when you’re ready to shape the trip around it.",
              artifact: result,
            },
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
    [conversationId, messages],
  );

  const answerClarification = useCallback(
    (answers: Record<string, AnswerValue>) => {
      if (!runId || !prompt) return Promise.resolve();
      return startRun(prompt, {
        answers,
        parentRunId: runId,
        intent: selectedHotel ? "FULL_TRIP_PLAN" : undefined,
        selectedHotel,
      });
    },
    [prompt, runId, selectedHotel, startRun],
  );

  const selectHotelAndPlan = useCallback(
    (property: HotelPropertyCandidate) => {
      if (!hotelResult) return Promise.resolve();
      const offer = property.offers[0];
      const selected: SelectedHotelContext = {
        search_id: hotelResult.search_id,
        property_id: property.property_id,
        provider_ids: property.provider_ids,
        name: property.name,
        location: property.location,
        selected_offer: offer,
        check_in: offer?.availability.check_in ?? hotelResult.constraints.check_in,
        check_out: offer?.availability.check_out ?? hotelResult.constraints.check_out,
        selection_source: "traveler",
      };
      setSelectedHotel(selected);
      const destination = hotelResult.constraints.destination_query
        ?? hotelResult.constraints.location?.label
        ?? property.location.city
        ?? property.location.label;
      const travelers = hotelResult.constraints.adults
        ? ` for ${hotelResult.constraints.adults} traveler${hotelResult.constraints.adults === 1 ? "" : "s"}`
        : "";
      return startRun(
        `Plan a trip to ${destination}${travelers} using my selected hotel, ${property.name}.`,
        {
          parentRunId: runId,
          intent: "FULL_TRIP_PLAN",
          selectedHotel: selected,
          followUpLabel: `Use ${property.name} as my trip base.`,
        },
      );
    },
    [hotelResult, runId, startRun],
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
    setHotelResult(undefined);
    setSelectedHotel(undefined);
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
    hotelResult,
    error,
    busy,
    startRun,
    answerClarification,
    selectHotelAndPlan,
    reset,
  };
}
