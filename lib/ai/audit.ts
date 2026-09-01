import type { ToolContext, ToolResult } from "@/lib/ai/types";

// Every tool call the assistant makes is recorded, successful or not, through
// ai_log_action — a definer function, so the row is written from the session
// and cannot be shaped or suppressed by anything the model said.
//
// This writes into the EXISTING audit_log (entity = 'ai_action'). Anything the
// assistant causes to post also lands in acct_audit by itself, because it
// posts through the ordinary accounting routines.
//
// Logging must never take the conversation down: a failure here is swallowed
// after being reported to the server console. The alternative — an audit
// hiccup killing a user's answer — is worse, and the tool result is still
// returned truthfully either way.
export async function logToolCall(
  ctx: ToolContext,
  tool: string,
  kind: "read" | "write",
  args: unknown,
  result: ToolResult,
  extra?: Record<string, unknown>
) {
  try {
    await ctx.sb.rpc("ai_log_action", {
      p_tool: tool,
      p_kind: kind,
      p_args: redact(args),
      p_result: {
        ok: result.ok,
        count: result.count ?? null,
        error: result.error ?? null,
        ...(extra ?? {}),
      },
    });
  } catch (e) {
    console.error("[vista-ai] audit write failed", tool, e);
  }
}

// Arguments are the user's own search terms and ids, not secrets — but a free
// text field could carry anything, so it is capped rather than stored whole.
function redact(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    out[k] = typeof v === "string" && v.length > 300 ? v.slice(0, 300) + "…" : v;
  }
  return out;
}
