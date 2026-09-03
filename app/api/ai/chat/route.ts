import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { getStaffAccess, getSessionUser, staffCan } from "@/lib/staffSession";
import { COMPANY_ID } from "@/lib/format";
import { AI_MODEL, AI_EFFORT, AI_MAX_TOKENS, AI_MAX_TURNS, aiConfigured } from "@/lib/ai/config";
import { systemPrompt, contextPrompt } from "@/lib/ai/persona";
import { toolSchemas, executeTool } from "@/lib/ai/registry";
import type { ToolContext } from "@/lib/ai/types";
import { sanitizePageContext } from "@/lib/ai/pageContext";
import { loadThread, startConversation, saveMessage } from "@/lib/ai/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ============================================================
// The orchestrator. One question in, a stream of events out.
//
// Events (SSE, `data:` is JSON):
//   {type:"conversation", id}       the thread this belongs to
//   {type:"text", delta}            a chunk of the spoken/typed answer
//   {type:"tool", name, status,     the assistant reaching into the ERP;
//                summary?, link?}   surfaced so the user sees what was read
//   {type:"confirm", action}        work is prepared and waiting on the user
//   {type:"error", message}         something failed — said plainly
//   {type:"done"}
//
// The model never touches Supabase. It picks a tool; the registry checks the
// caller's permission, calls the ERP's own RPC under the caller's session, and
// writes the audit row. That is the whole security model, and it is the same
// one the screens run under.
// ============================================================

function sse(obj: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`);
}

export async function POST(req: Request) {
  const sb = createClient();
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  const access = await getStaffAccess();
  if (!staffCan(access, "ai.use")) {
    return Response.json({ error: "You don't have access to Vista AI." }, { status: 403 });
  }
  if (!aiConfigured()) {
    return Response.json(
      { error: "Vista AI is not configured on the server yet (ANTHROPIC_API_KEY)." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => ({} as any));
  const message = String(body?.message ?? "").trim();
  // Route, screen name and record id only, all shape-checked. It steers
  // her attention; it never grants access, because every tool re-reads the
  // record under this user's own session and permissions.
  const page = sanitizePageContext(body?.page);
  if (!message) return Response.json({ error: "Say something first." }, { status: 400 });

  const ctx: ToolContext = { sb, companyId: COMPANY_ID, userId: user.id, access, page };
  const client = new Anthropic();

  // Prior turns, so "the biggest three" still means something after a reload.
  let conversationId: string | null = body?.conversation_id ?? null;
  const history = conversationId ? await loadThread(sb, conversationId) : [];

  const messages: Anthropic.MessageParam[] = [
    ...history,
    { role: "user", content: message },
  ];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(sse(o));
      let closed = false;
      const close = () => { if (!closed) { closed = true; controller.close(); } };

      try {
        if (!conversationId) {
          conversationId = await startConversation(sb, user.id, COMPANY_ID, message);
        }
        send({ type: "conversation", id: conversationId });
        await saveMessage(sb, conversationId, "user", message, [{ type: "text", text: message }]);

        const tools = toolSchemas(access);
        const system: Anthropic.TextBlockParam[] = [
          { type: "text", text: systemPrompt(access), cache_control: { type: "ephemeral" } },
          { type: "text", text: contextPrompt({ userName: access.fullName, page }) },
        ];

        for (let turn = 0; turn < AI_MAX_TURNS; turn++) {
          const run = client.messages.stream({
            model: AI_MODEL,
            max_tokens: AI_MAX_TOKENS,
            thinking: { type: "adaptive" },
            output_config: { effort: AI_EFFORT },
            system,
            tools,
            messages,
          });

          run.on("text", (delta) => send({ type: "text", delta }));

          const reply = await run.finalMessage();
          messages.push({ role: "assistant", content: reply.content });

          const text = reply.content
            .filter((b): b is Anthropic.TextBlock => b.type === "text")
            .map((b) => b.text)
            .join("");
          await saveMessage(sb, conversationId, "assistant", text || null, reply.content as unknown[]);

          if (reply.stop_reason === "refusal") {
            send({ type: "error", message: "I can't help with that one." });
            break;
          }
          if (reply.stop_reason !== "tool_use") break;

          const calls = reply.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
          );

          // Parallel calls are executed together and their results returned in
          // ONE user message — splitting them teaches the model to stop
          // batching, and every extra round trip is felt in a spoken answer.
          const results = await Promise.all(
            calls.map(async (call) => {
              send({ type: "tool", name: call.name, status: "running" });
              const result = await executeTool(call.name, call.input, ctx);
              send({
                type: "tool",
                name: call.name,
                status: result.ok ? "done" : "failed",
                summary: result.ok ? result.summary ?? null : result.error ?? null,
                link: result.link ?? null,
              });

              // A preparing tool stages the work and hands back what it would
              // do. That becomes the confirmation card. The card is the ONLY
              // way the work can then run — see app/api/ai/action.
              const pending = (result.data as any)?.awaiting_confirmation;
              if (result.ok && pending?.action_id) {
                send({ type: "confirm", action: pending });
              }
              return { call, result };
            })
          );

          const toolResults: Anthropic.ToolResultBlockParam[] = results.map(({ call, result }) => ({
            type: "tool_result",
            tool_use_id: call.id,
            is_error: !result.ok,
            content: JSON.stringify(result.ok ? result.data ?? {} : { error: result.error }),
          }));

          messages.push({ role: "user", content: toolResults });
          await saveMessage(sb, conversationId, "user", null, toolResults as unknown[]);

          if (turn === AI_MAX_TURNS - 1) {
            send({
              type: "error",
              message: "That took more steps than I'm allowed in one go. Ask me for the next part and I'll carry on.",
            });
          }
        }

        send({ type: "done" });
      } catch (e: any) {
        console.error("[vista-ai] chat failed", e);
        const message =
          e instanceof Anthropic.RateLimitError
            ? "Vista AI is rate limited right now. Try again in a moment."
            : e instanceof Anthropic.AuthenticationError
            ? "Vista AI's API key was rejected. An administrator needs to check it."
            : e instanceof Anthropic.APIError
            // Carry the API's own words through. "Returned an error (400)" is
            // untraceable from the screen; the reason is what makes it fixable.
            ? `Vista AI returned an error (${e.status}): ${String(e.message ?? "").slice(0, 300)}`
            : `Something went wrong while I was working on that: ${String(e?.message ?? "unknown").slice(0, 300)}`;
        send({ type: "error", message });
        send({ type: "done" });
      } finally {
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
