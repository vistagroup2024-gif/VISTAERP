import type { AiTool, ToolContext } from "@/lib/ai/types";
import { ok, num, today, addDays } from "@/lib/ai/tools/shared";
import { staffCan } from "@/lib/staffSession";

// ============================================================
// "What do I need to handle today?"
//
// Every line comes from a real query. Nothing is generated, nothing is
// inferred from "it's Monday", and an empty ERP produces an empty list —
// which is the correct answer, not a reason to make something up.
//
// This tool spans modules, so it gates each section on that module's own
// permission rather than on one blanket key. Someone who can see transport
// but not accounting gets the transport lines and is TOLD that accounting was
// left out, so a short list never reads as "nothing to do".
//
// Ranking is by consequence, not by recency:
//   urgent    — money already late, or something that blocks a guest today
//   attention — needs a decision soon but nothing is broken yet
//   normal    — today's shape of work, for context
// ============================================================

interface Item {
  priority: "urgent" | "attention" | "normal";
  area: string;
  what: string;
  count?: number;
  amount?: number;
  link?: string;
}

const priorities: AiTool = {
  name: "get_priorities",
  description:
    "What needs handling, ranked. Reads overdue receivables, vouchers awaiting authorisation, " +
    "arrivals whose service isn't set, and today's transport and hotel movements — each only if " +
    "the user has that module. Use it for 'what do I need to handle today', 'what's urgent', " +
    "'anything I've missed'. Report what it returns and nothing else: if a section is empty, say " +
    "that area is clear.",
  kind: "read",
  perm: "ai.use",
  schema: { type: "object", properties: {}, additionalProperties: false },

  async run(_args, ctx) {
    const t = today();
    const items: Item[] = [];
    const skipped: string[] = [];
    const failed: string[] = [];

    const can = (key: string) => staffCan(ctx.access, key);

    // ---- Money that is already late -------------------------------------
    if (can("accounting.view")) {
      await Promise.all([
        (async () => {
          const { data, error } = await ctx.sb.rpc("ar_ap_aging", {
            p_company: ctx.companyId, p_kind: "customer", p_as_of: t,
          });
          if (error) { failed.push("receivables aging"); return; }
          const rows = (data ?? []) as any[];
          const late = rows
            .map((r) => ({ name: r.name, overdue: num(r.b1) + num(r.b2) + num(r.b3) + num(r.b4) }))
            .filter((r) => r.overdue > 0);
          if (late.length) {
            const total = late.reduce((s, r) => s + r.overdue, 0);
            const worst = late.sort((a, b) => b.overdue - a.overdue).slice(0, 3).map((r) => r.name);
            items.push({
              priority: "urgent", area: "Receivables",
              what: `${late.length} customer${late.length === 1 ? "" : "s"} overdue past 30 days. Biggest: ${worst.join(", ")}.`,
              count: late.length, amount: total, link: "/accounting/aging?kind=customer",
            });
          }
        })(),

        (async () => {
          const { data, error } = await ctx.sb.rpc("pending_inbox", {
            p_company: ctx.companyId, p_status: "pending",
          });
          if (error) { failed.push("approval inbox"); return; }
          const rows = (data ?? []) as any[];
          if (rows.length) {
            const total = rows.reduce((s, r) => s + num(r.amount), 0);
            items.push({
              priority: "urgent", area: "Accounting",
              what: `${rows.length} voucher${rows.length === 1 ? "" : "s"} waiting for authorisation.`,
              count: rows.length, amount: total, link: "/accounting/approvals",
            });
          }
        })(),
      ]);
    } else {
      skipped.push("accounting");
    }

    // ---- Guests arriving without their service settled ------------------
    if (can("transport.operations")) {
      const { data, error } = await ctx.sb.rpc("arrival_compliance", { p_days: 3 });
      if (error) failed.push("arrival compliance");
      else {
        // The RPC is already the exception list: it returns only groups whose
        // arrival_service_state is still 'pending'. Every row is a group that
        // needs handling, so filtering again would only lose some.
        const open = (data ?? []) as any[];
        if (open.length) {
          const soonest = open[0];
          items.push({
            priority: "urgent", area: "Arrivals",
            what:
              `${open.length} group${open.length === 1 ? "" : "s"} arriving within 3 days with no arrival service set` +
              (soonest?.group_no ? ` — soonest is ${soonest.group_no} on ${soonest.arrival_date}.` : "."),
            count: open.length, link: "/transport/arrivals",
          });
        }
      }
    }

    // ---- Today and tomorrow's movements ---------------------------------
    if (can("transport.bookings")) {
      const { data, error } = await ctx.sb
        .from("transport_bookings")
        .select("id, status, arrival_date, departure_date")
        .eq("company_id", ctx.companyId)
        .or(`and(arrival_date.gte.${t},arrival_date.lte.${addDays(t, 1)}),` +
            `and(departure_date.gte.${t},departure_date.lte.${addDays(t, 1)})`)
        .limit(500);
      if (error) failed.push("transport bookings");
      else {
        const rows = (data ?? []) as any[];
        const pending = rows.filter((r) => r.status === "pending");
        if (pending.length) {
          items.push({
            priority: "attention", area: "Transport",
            what: `${pending.length} booking${pending.length === 1 ? "" : "s"} still pending for today or tomorrow.`,
            count: pending.length, link: "/transport/bookings",
          });
        }
        if (rows.length) {
          items.push({
            priority: "normal", area: "Transport",
            what: `${rows.length} transport movement${rows.length === 1 ? "" : "s"} today and tomorrow.`,
            count: rows.length, link: "/transport/operations",
          });
        }
      }
    } else {
      skipped.push("transport");
    }

    if (can("hotels.bookings")) {
      const { data, error } = await ctx.sb
        .from("hotel_bookings")
        .select("id, status, check_in")
        .eq("company_id", ctx.companyId)
        .gte("check_in", t).lte("check_in", addDays(t, 1))
        .limit(500);
      if (error) failed.push("hotel bookings");
      else {
        const rows = (data ?? []) as any[];
        const pending = rows.filter((r) => r.status === "pending");
        if (pending.length) {
          items.push({
            priority: "attention", area: "Hotels",
            what: `${pending.length} hotel booking${pending.length === 1 ? "" : "s"} still pending for today or tomorrow.`,
            count: pending.length, link: "/hotels/bookings",
          });
        }
        const todays = rows.filter((r) => r.check_in === t);
        if (todays.length) {
          items.push({
            priority: "normal", area: "Hotels",
            what: `${todays.length} check-in${todays.length === 1 ? "" : "s"} today.`,
            count: todays.length, link: "/hotels/checkin",
          });
        }
      }
    } else {
      skipped.push("hotels");
    }

    const by = (p: Item["priority"]) => items.filter((i) => i.priority === p);
    const urgent = by("urgent"), attention = by("attention"), normal = by("normal");

    return ok(
      {
        date: t,
        currency: "SAR",
        urgent, attention, normal,
        nothing_urgent: urgent.length === 0,
        // Said out loud so a short list is never mistaken for a quiet day.
        modules_not_visible_to_this_user: skipped.length ? skipped : undefined,
        could_not_check: failed.length ? failed : undefined,
      },
      {
        count: items.length,
        summary: `Priorities — ${urgent.length} urgent, ${attention.length} needing attention`,
      }
    );
  },
};

export const PRIORITY_TOOLS: AiTool[] = [priorities];

// Kept exported for the Tasks tab, which shows the same idea as a screen.
export type { Item as PriorityItem, ToolContext as PriorityContext };
