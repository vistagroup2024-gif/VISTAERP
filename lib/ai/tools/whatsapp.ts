import type { AiTool, ToolContext } from "@/lib/ai/types";
import { ok, fail, fromError, num, today } from "@/lib/ai/tools/shared";
import { normalizeWa } from "@/lib/waLink";
import { waMsg } from "@/lib/waMessages";
import { whatsappConfigured } from "@/lib/whatsapp";

// ============================================================
// Preparing WhatsApp payment reminders.
//
// This tool PREPARES. It does not send, and there is no sending tool — see
// migration 284. It works out who is overdue, writes each person's message,
// and parks the whole thing as a pending action. The user sees the list and
// presses Confirm, and that request sends. The model is not in the loop at the
// moment anything leaves the building.
//
// Nothing here is a new WhatsApp system. The overdue list is ar_ap_aging (the
// Aging screen's own RPC), the wording is waMsg.paymentReminder (already used
// by the WhatsApp button on that screen), the number handling is normalizeWa,
// and sending — when it happens — goes through lib/whatsapp.ts into
// transport_outbox, the delivery queue the Confirmations screen already shows.
// ============================================================

export interface PreparedRecipient {
  account_id: string;
  name: string;
  phone: string | null;
  wa: string | null;
  outstanding: number;
  overdue: number;
  message: string;
}

const prepareReminders: AiTool = {
  name: "prepare_payment_reminders",
  description:
    "Draft WhatsApp payment reminders for overdue customers and show them for approval. This does " +
    "NOT send anything — it prepares the messages and returns them for the user to confirm, and the " +
    "user's confirmation is what sends them. Use it when asked to prepare, draft or 'send' reminders; " +
    "in the last case make clear that nothing goes out until they confirm. " +
    "Say how many were prepared and the total outstanding, then wait.",
  kind: "write",
  perm: "accounting.view",
  schema: {
    type: "object",
    properties: {
      min_amount: { type: "number", description: "Only customers owing at least this much." },
      overdue_only: { type: "boolean", description: "Only those with something past 30 days. Defaults to true." },
      account_ids: {
        type: "array",
        items: { type: "string" },
        description: "Specific ledger account ids, when the user named particular customers rather than a rule.",
      },
    },
    additionalProperties: false,
  },

  async run(args, ctx) {
    if (!whatsappConfigured()) {
      // Said now, not after the user has approved a send that cannot happen.
      return fail(
        "WhatsApp isn't configured on this server, so I can't prepare reminders to send. " +
          "An administrator needs to set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID."
      );
    }

    const { data, error } = await ctx.sb.rpc("ar_ap_aging", {
      p_company: ctx.companyId, p_kind: "customer", p_as_of: today(),
    });
    if (error) return fromError(error, "Could not read the aging report.");

    const wanted: string[] | null = Array.isArray(args?.account_ids) && args.account_ids.length
      ? args.account_ids.map(String)
      : null;
    const overdueOnly = args?.overdue_only !== false;

    let rows = ((data ?? []) as any[]).map((r) => {
      const overdue = num(r.b1) + num(r.b2) + num(r.b3) + num(r.b4);
      return {
        account_id: String(r.account_id), name: String(r.name ?? ""),
        phone: (r.phone as string | null) ?? null,
        outstanding: num(r.total), overdue,
      };
    });

    if (wanted) rows = rows.filter((r) => wanted.includes(r.account_id));
    else if (overdueOnly) rows = rows.filter((r) => r.overdue > 0);
    if (typeof args?.min_amount === "number") rows = rows.filter((r) => r.outstanding >= args.min_amount);
    rows.sort((a, b) => b.outstanding - a.outstanding);

    if (rows.length === 0) {
      return ok({ prepared: 0, note: "Nobody matches that." },
        { count: 0, summary: "No customers matched — nothing prepared" });
    }

    const recipients: PreparedRecipient[] = rows.map((r) => ({
      ...r,
      wa: normalizeWa(r.phone),
      message: waMsg.paymentReminder({ name: r.name, amount: r.outstanding, currency: "SAR" }),
    }));

    const sendable = recipients.filter((r) => r.wa);
    const unreachable = recipients.filter((r) => !r.wa);
    const total = sendable.reduce((s, r) => s + r.outstanding, 0);

    if (sendable.length === 0) {
      return ok(
        {
          prepared: 0,
          matched: recipients.length,
          note: "Every one of them is missing a usable WhatsApp number, so there is nothing to send.",
          missing_numbers: unreachable.map((r) => r.name),
        },
        { count: 0, summary: `${recipients.length} matched, none with a WhatsApp number` }
      );
    }

    const title = `Send ${sendable.length} WhatsApp payment reminder${sendable.length === 1 ? "" : "s"}`;
    const summary =
      `${sendable.length} customer${sendable.length === 1 ? "" : "s"}, SAR ${total.toFixed(2)} outstanding` +
      (unreachable.length ? ` · ${unreachable.length} skipped (no WhatsApp number)` : "");

    const actionId = await stage(ctx, {
      kind: "whatsapp_payment_reminders",
      title,
      summary,
      payload: { recipients: sendable, skipped: unreachable.map((r) => ({ name: r.name, phone: r.phone })) },
    });

    if (!actionId) {
      return fail("I prepared the messages but couldn't stage them for approval, so I haven't offered to send them.");
    }

    return ok(
      {
        // The shape the orchestrator looks for to raise a confirmation card.
        awaiting_confirmation: {
          action_id: actionId,
          kind: "whatsapp_payment_reminders",
          title,
          summary,
          total_outstanding: total,
          currency: "SAR",
          recipients: sendable.map((r) => ({
            name: r.name, phone: r.wa, outstanding: r.outstanding, message: r.message,
          })),
          skipped: unreachable.map((r) => ({ name: r.name, reason: "No usable WhatsApp number" })),
        },
        instruction:
          "Nothing has been sent. Tell the user what you prepared and that they need to confirm it. " +
          "Do not claim anything was sent.",
      },
      { count: sendable.length, summary: `Prepared ${sendable.length} reminder(s) — awaiting confirmation` }
    );
  },
};

/** Park a prepared action for the user to confirm. Returns its id, or null. */
async function stage(
  ctx: ToolContext,
  action: { kind: string; title: string; summary: string; payload: Record<string, unknown> }
): Promise<string | null> {
  try {
    const { data, error } = await ctx.sb
      .from("ai_pending_actions")
      .insert({
        company_id: ctx.companyId,
        user_id: ctx.userId,
        kind: action.kind,
        title: action.title,
        summary: action.summary,
        payload: action.payload,
      })
      .select("id")
      .single();
    if (error) throw error;
    return (data as any).id as string;
  } catch (e) {
    console.error("[vista-ai] could not stage action", e);
    return null;
  }
}

export const WHATSAPP_TOOLS: AiTool[] = [prepareReminders];
