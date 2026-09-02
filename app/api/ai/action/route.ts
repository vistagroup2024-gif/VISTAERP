import { createClient } from "@/lib/supabase/server";
import { getStaffAccess, getSessionUser, staffCan } from "@/lib/staffSession";
import { COMPANY_ID } from "@/lib/format";
import { sendWhatsApp, whatsappConfigured } from "@/lib/whatsapp";
import type { PreparedRecipient } from "@/lib/ai/tools/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ============================================================
// Where a prepared action actually happens — and the only place it can.
//
// The model has no path here. This endpoint is reached by the user pressing
// Confirm in their own browser, on their own session. By the time anything is
// sent, three things have been checked independently of anything the model
// said: the user holds ai.actions, the user holds the module permission the
// work needs, and the prepared row is theirs, still pending and not stale.
//
// The work is carried out from the payload written when it was prepared, never
// re-derived. What was shown is what is done — a fresh lookup at this point
// could quietly act on a different list than the one that was approved.
//
// Nothing is reported as sent unless the provider said so.
// ============================================================

// Each kind names the module permission it needs on top of ai.actions.
const REQUIRED_PERM: Record<string, string> = {
  whatsapp_payment_reminders: "accounting.view",
};

export async function POST(req: Request) {
  const sb = createClient();
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  const access = await getStaffAccess();
  if (!staffCan(access, "ai.use")) {
    return Response.json({ error: "You don't have access to Vista AI." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({} as any));
  const id = String(body?.id ?? "");
  const decision = body?.decision === "confirm" ? "confirm" : "cancel";
  if (!id) return Response.json({ error: "Which action?" }, { status: 400 });

  // RLS already scopes this to the caller's own rows; the explicit user_id
  // check is a second lock on the same door.
  const { data: row, error } = await sb
    .from("ai_pending_actions")
    .select("id, kind, title, summary, payload, status, expires_at, user_id")
    .eq("id", id)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 400 });
  if (!row || (row as any).user_id !== user.id) {
    return Response.json({ error: "That action isn't yours, or no longer exists." }, { status: 404 });
  }

  const action = row as any;

  if (action.status !== "pending") {
    return Response.json(
      { error: `That was already ${action.status}. Ask me to prepare it again if you want it done.` },
      { status: 409 }
    );
  }

  if (decision === "cancel") {
    await sb.from("ai_pending_actions")
      .update({ status: "cancelled", decided_at: new Date().toISOString() })
      .eq("id", id);
    await log(sb, action.kind, { ok: true, cancelled: true, action_id: id });
    return Response.json({ ok: true, status: "cancelled" });
  }

  // Stale means the balances behind it have had time to move. Better to
  // re-prepare than to send yesterday's truth.
  if (new Date(action.expires_at).getTime() < Date.now()) {
    await sb.from("ai_pending_actions")
      .update({ status: "expired", decided_at: new Date().toISOString() })
      .eq("id", id);
    return Response.json(
      { error: "That was prepared over an hour ago, so the figures may have moved. Ask me to prepare it again." },
      { status: 409 }
    );
  }

  if (!staffCan(access, "ai.actions")) {
    return Response.json(
      { error: "You're not allowed to have Vista AI carry out actions. An administrator grants that." },
      { status: 403 }
    );
  }
  const needed = REQUIRED_PERM[action.kind];
  if (!needed) {
    return Response.json({ error: "I don't know how to carry that out." }, { status: 400 });
  }
  if (!staffCan(access, needed)) {
    return Response.json({ error: "You don't have permission for that." }, { status: 403 });
  }

  // ---- Carry it out --------------------------------------------------------
  try {
    const result = await execute(action.kind, action.payload, sb, user.id);

    await sb.from("ai_pending_actions")
      .update({
        status: result.ok ? "executed" : "failed",
        result,
        error: result.ok ? null : result.error ?? "Failed",
        decided_at: new Date().toISOString(),
      })
      .eq("id", id);

    await log(sb, action.kind, { ...result, action_id: id });
    return Response.json({ ...result });
  } catch (e: any) {
    const message = e?.message || "That failed while it was running.";
    await sb.from("ai_pending_actions")
      .update({ status: "failed", error: message, decided_at: new Date().toISOString() })
      .eq("id", id);
    await log(sb, action.kind, { ok: false, error: message, action_id: id });
    return Response.json({ error: message }, { status: 500 });
  }
}

interface ExecResult {
  ok: boolean;
  sent?: number;
  failed?: number;
  total?: number;
  failures?: { name: string; error: string }[];
  error?: string;
  message: string;
}

async function execute(kind: string, payload: any, sb: any, userId: string): Promise<ExecResult> {
  if (kind !== "whatsapp_payment_reminders") {
    return { ok: false, error: "Unknown action", message: "I don't know how to carry that out." };
  }
  return sendReminders(payload, sb, userId);
}

/**
 * Queue each reminder in transport_outbox — the ERP's existing delivery
 * queue, visible on the Confirmations screen — then send it through
 * lib/whatsapp.ts. The row records what the provider actually said, so a
 * message shows as sent only if it was, and a failure keeps its real error.
 */
async function sendReminders(payload: any, sb: any, userId: string): Promise<ExecResult> {
  if (!whatsappConfigured()) {
    return {
      ok: false,
      error: "WhatsApp is not configured",
      message: "WhatsApp isn't configured on the server, so nothing was sent.",
    };
  }

  const recipients: PreparedRecipient[] = Array.isArray(payload?.recipients) ? payload.recipients : [];
  if (recipients.length === 0) {
    return { ok: false, error: "Nothing to send", message: "There was nothing left to send." };
  }

  let sent = 0;
  const failures: { name: string; error: string }[] = [];

  for (const r of recipients) {
    if (!r.wa) { failures.push({ name: r.name, error: "No WhatsApp number" }); continue; }

    // Queue first, so an interrupted run leaves a record of what was attempted
    // rather than a silent gap.
    const { data: queued } = await sb
      .from("transport_outbox")
      .insert({
        company_id: COMPANY_ID, channel: "whatsapp", to_addr: r.wa,
        body: r.message, status: "queued", created_by: userId,
      })
      .select("id")
      .single();

    const res = await sendWhatsApp(r.wa, r.message);

    if (queued?.id) {
      await sb.from("transport_outbox").update(
        res.ok
          ? { status: "sent", sent_at: new Date().toISOString(), provider: "whatsapp_cloud", provider_id: res.id ?? null, error: null }
          : { status: "failed", provider: "whatsapp_cloud", error: res.error ?? "Send failed" }
      ).eq("id", queued.id);
    }

    if (res.ok) sent++;
    else failures.push({ name: r.name, error: res.error ?? "Send failed" });
  }

  const failed = failures.length;
  const message =
    sent === 0
      ? `None of the ${recipients.length} messages went out. ${failures[0]?.error ?? ""}`.trim()
      : failed === 0
      ? `Sent ${sent} reminder${sent === 1 ? "" : "s"}.`
      : `Sent ${sent} of ${recipients.length}. ${failed} failed.`;

  return { ok: sent > 0, sent, failed, total: recipients.length, failures, message };
}

async function log(sb: any, kind: string, detail: Record<string, unknown>) {
  try {
    await sb.rpc("ai_log_action", {
      p_tool: kind, p_kind: "write", p_args: {}, p_result: { confirmed: true, ...detail },
    });
  } catch (e) {
    console.error("[vista-ai] audit write failed", kind, e);
  }
}
