import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// Conversation persistence.
//
// Deliberately best-effort. A thread that fails to save is a lost thread; a
// thread that fails to save AND takes the answer down with it is a broken
// assistant. So every function here swallows its error after logging it, and
// the conversation carries on in memory for the rest of the request.
//
// That also means the feature runs before migration 282 is applied — the
// assistant answers, it just doesn't remember. Useful while a preview is
// being tested against a database that hasn't been migrated yet.
// ============================================================

type SB = SupabaseClient<any, any, any>;

const TITLE_MAX = 60;

export async function startConversation(
  sb: SB, userId: string, companyId: string, firstMessage: string
): Promise<string | null> {
  const title = firstMessage.length > TITLE_MAX ? firstMessage.slice(0, TITLE_MAX) + "…" : firstMessage;
  try {
    const { data, error } = await sb
      .from("ai_conversations")
      .insert({ user_id: userId, company_id: companyId, title })
      .select("id")
      .single();
    if (error) throw error;
    return (data as any).id as string;
  } catch (e) {
    console.error("[vista-ai] could not start conversation", e);
    return null;
  }
}

export async function saveMessage(
  sb: SB, conversationId: string | null, role: "user" | "assistant",
  text: string | null, blocks: unknown
): Promise<void> {
  if (!conversationId) return;
  try {
    const { error } = await sb
      .from("ai_messages")
      .insert({ conversation_id: conversationId, role, text, blocks });
    if (error) throw error;
  } catch (e) {
    console.error("[vista-ai] could not save message", e);
  }
}

/**
 * Replay a thread in the shape the Messages API wants. The stored `blocks` are
 * the exact content arrays that were sent and received, tool_use/tool_result
 * pairs included, so a resumed conversation is the same conversation — not a
 * summary of one.
 *
 * Only the last KEEP messages are replayed. Beyond that the thread is old
 * enough that resending it costs more than it is worth, and the user can
 * always restate what they want.
 */
const KEEP = 40;

export async function loadThread(sb: SB, conversationId: string): Promise<Anthropic.MessageParam[]> {
  try {
    const { data, error } = await sb
      .from("ai_messages")
      .select("role, blocks")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(400);
    if (error) throw error;

    const rows = ((data ?? []) as any[]).filter((r) => Array.isArray(r.blocks) && r.blocks.length);
    const tail = rows.slice(-KEEP);

    // A thread must not open on a tool_result with no matching tool_use — the
    // API rejects that. If trimming landed mid-exchange, drop forward to the
    // first plain user turn.
    let start = 0;
    for (let i = 0; i < tail.length; i++) {
      const first = tail[i].blocks[0];
      if (tail[i].role === "user" && first?.type !== "tool_result") { start = i; break; }
    }

    return tail.slice(start).map((r) => ({
      role: r.role as "user" | "assistant",
      content: r.blocks as any,
    }));
  } catch (e) {
    console.error("[vista-ai] could not load thread", e);
    return [];
  }
}
