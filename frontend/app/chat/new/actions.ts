"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { callBackend } from "@/lib/trip-api/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function deleteConversation(conversationId: string) {
  if (!UUID_PATTERN.test(conversationId)) {
    return { error: "This conversation could not be deleted." };
  }

  let response: Response;
  try {
    response = await callBackend(`/api/v1/conversations/${conversationId}`, {
      method: "DELETE",
    });
  } catch (error) {
    console.error("Conversation deletion request failed", error);
    return { error: "We couldn't delete this conversation. Please try again." };
  }

  if (!response.ok) {
    console.error("Conversation deletion failed", response.status, await response.text());
    return {
      error: response.status === 404
        ? "This conversation was already removed or could not be found."
        : "We couldn't delete this conversation. Please try again.",
    };
  }

  revalidatePath("/chat", "layout");
  return { error: null };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
