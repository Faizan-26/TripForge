import "server-only";

import { createClient } from "@/lib/supabase/server";
import type {
  ConversationArtifact,
  ConversationDetail,
  ConversationMessage,
  ConversationRun,
  ConversationSummary,
} from "@/lib/trip-api/types";

export async function getConversationList(): Promise<ConversationSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conversations")
    .select("id,title,status,last_message_at,created_at,updated_at")
    .is("deleted_at", null)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw new Error("Could not load conversations", { cause: error });
  return (data ?? []) as ConversationSummary[];
}

export async function getConversationDetail(
  conversationId: string,
): Promise<ConversationDetail | null> {
  const supabase = await createClient();
  const conversationQuery = supabase
    .from("conversations")
    .select("id,title,status,last_message_at,created_at,updated_at")
    .eq("id", conversationId)
    .is("deleted_at", null)
    .maybeSingle();
  const messagesQuery = supabase
    .from("messages")
    .select("id,public_id,role,status,content,metadata,created_at")
    .eq("conversation_id", conversationId)
    .order("id", { ascending: true });
  const runsQuery = supabase
    .from("agent_runs")
    .select("id,trigger_message_id,parent_run_id,status,error_message,created_at,updated_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  const artifactsQuery = supabase
    .from("artifacts")
    .select("id,run_id,kind,version,status,is_current,title,payload,created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  const eventsQuery = supabase
    .from("agent_run_events")
    .select("payload")
    .eq("conversation_id", conversationId)
    .order("id", { ascending: true });

  const [conversation, messages, runs, artifacts, events] = await Promise.all([
    conversationQuery,
    messagesQuery,
    runsQuery,
    artifactsQuery,
    eventsQuery,
  ]);
  const error = conversation.error ?? messages.error ?? runs.error ?? artifacts.error;
  if (error) throw new Error("Could not load conversation", { cause: error });
  if (!conversation.data) return null;

  return {
    conversation: conversation.data as ConversationSummary,
    messages: (messages.data ?? []) as ConversationMessage[],
    runs: (runs.data ?? []) as ConversationRun[],
    artifacts: (artifacts.data ?? []) as ConversationArtifact[],
    events: (events.data ?? []).flatMap((row) => {
      const payload = row.payload;
      return payload && typeof payload === "object"
        ? [payload as ConversationDetail["events"][number]]
        : [];
    }),
  };
}
