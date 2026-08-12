import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ChatWorkspace } from "./TripDraft";

export default async function NewChatPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims?.sub) redirect("/?auth=required");

  const email = typeof data.claims.email === "string" ? data.claims.email : "Traveler";

  return <ChatWorkspace email={email} />;
}
