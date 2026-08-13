import { notFound, redirect } from "next/navigation";
import { getConversationDetail, getConversationList } from "@/lib/conversations/server";
import { createClient } from "@/lib/supabase/server";
import { ChatWorkspace } from "../new/TripDraft";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const supabase = await createClient();
  const [{ data, error }, { conversationId }] = await Promise.all([
    supabase.auth.getClaims(),
    params,
  ]);

  if (error || !data?.claims?.sub) redirect("/?auth=required");
  if (!UUID_PATTERN.test(conversationId)) notFound();

  const [conversations, conversation] = await Promise.all([
    getConversationList(),
    getConversationDetail(conversationId),
  ]);
  if (!conversation) notFound();

  const email = typeof data.claims.email === "string" ? data.claims.email : "Traveler";
  return <ChatWorkspace
    key={conversationId}
    email={email}
    initialConversations={conversations}
    initialConversation={conversation}
  />;
}
