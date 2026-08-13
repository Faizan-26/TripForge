import { redirect } from "next/navigation";
import { getConversationList } from "@/lib/conversations/server";
import { createClient } from "@/lib/supabase/server";
import { ChatWorkspace } from "./TripDraft";

export default async function NewChatPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims?.sub) redirect("/?auth=required");

  const conversations = await getConversationList();
  const email = typeof data.claims.email === "string" ? data.claims.email : "Traveler";

  return <ChatWorkspace key="new" email={email} initialConversations={conversations} />;
}
