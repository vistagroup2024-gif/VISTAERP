import type { AiTool } from "@/lib/ai/types";
import { ok, fail, fromError, cap, num, today, addDays } from "@/lib/ai/tools/shared";

// ============================================================
// Operations read tools — Transport, Hotels, Visa.
//
// Each one is gated on the SAME permission key the corresponding sidebar
// module uses, so a user who cannot open /transport cannot ask the assistant
// about transport either. Rows come back through the caller's own session, so
// RLS applies exactly as it does on the screen.
//
// Note there is no Air Ticket tool: Vista ERP has no air-ticket module. Air
// ticket exists only as a line type in the Service Catalog, so there is no
// ticket record to look up and nothing truthful to answer with.
// ============================================================

// "tomorrow", "today", an explicit date, or a range. Resolved here rather than
// left to the model so a date is never guessed.
function range(args: any): { from: string; to: string; label: string } {
  const t = today();
  if (args?.from || args?.to) {
    const from = args.from || t;
    return { from, to: args.to || from, label: `${from} to ${args.to || from}` };
  }
  switch (args?.when) {
    case "tomorrow": { const d = addDays(t, 1); return { from: d, to: d, label: "tomorrow" }; }
    case "yesterday": { const d = addDays(t, -1); return { from: d, to: d, label: "yesterday" }; }
    case "week": return { from: t, to: addDays(t, 7), label: "the next 7 days" };
    default: return { from: t, to: t, label: "today" };
  }
}

const WHEN = {
  type: "string",
  enum: ["today", "tomorrow", "yesterday", "week"],
  description: "Relative period. Default today. Use from/to instead for an explicit range.",
} as const;

const transportBookings: AiTool = {
  name: "get_transport_bookings",
  description:
    "Transport bookings for a date or range: booking number, status, passenger, pax, flight and " +
    "arrival/departure timing. Use for \"tomorrow's transport\", \"which bookings are pending\", " +
    "or to find one passenger's booking.",
  kind: "read",
  perm: "transport.bookings",
  schema: {
    type: "object",
    properties: {
      when: WHEN,
      from: { type: "string", description: "YYYY-MM-DD" },
      to: { type: "string", description: "YYYY-MM-DD" },
      status: { type: "string", description: "Filter by booking status, e.g. pending, confirmed, cancelled." },
      passenger: { type: "string", description: "Part of the passenger name or mobile number." },
    },
    additionalProperties: false,
  },
  async run(args, ctx) {
    const r = range(args);
    let sel = ctx.sb.from("transport_bookings")
      .select("id, booking_no, booking_type, status, booking_date, pax, passenger_name, mobile, " +
              "arrival_flight, arrival_date, arrival_time, departure_flight, departure_date, departure_time, " +
              "net_amount, currency")
      .eq("company_id", ctx.companyId)
      .order("arrival_date", { ascending: true })
      .limit(200);

    // A booking is "on" a day if it arrives or departs that day.
    sel = sel.or(
      `and(arrival_date.gte.${r.from},arrival_date.lte.${r.to}),` +
      `and(departure_date.gte.${r.from},departure_date.lte.${r.to})`
    );
    if (args?.status) sel = sel.eq("status", String(args.status));
    if (args?.passenger) {
      const q = String(args.passenger);
      sel = sel.or(`passenger_name.ilike.%${q}%,mobile.ilike.%${q}%`);
    }

    const { data, error } = await sel;
    if (error) return fromError(error, "Could not read transport bookings.");
    const rows = (data ?? []) as any[];
    const { rows: shown, total, truncated } = cap(rows);

    return ok(
      { period: r.label, from: r.from, to: r.to, count: total, truncated, bookings: shown },
      { count: total, summary: `Transport — ${total} booking(s) for ${r.label}`, link: "/transport/bookings" }
    );
  },
};

const hotelBookings: AiTool = {
  name: "get_hotel_bookings",
  description:
    "Hotel bookings by check-in or check-out date: booking number, guest, hotel, city, room count, " +
    "nights and status. Use for \"today's check-ins\", \"tomorrow's check-outs\" and pending bookings.",
  kind: "read",
  perm: "hotels.bookings",
  schema: {
    type: "object",
    properties: {
      when: WHEN,
      basis: { type: "string", enum: ["check_in", "check_out"], description: "Which date to filter on. Default check_in." },
      from: { type: "string", description: "YYYY-MM-DD" },
      to: { type: "string", description: "YYYY-MM-DD" },
      status: { type: "string", description: "Filter by status." },
      guest: { type: "string", description: "Part of the guest name or mobile number." },
    },
    additionalProperties: false,
  },
  async run(args, ctx) {
    const r = range(args);
    const basis = args?.basis === "check_out" ? "check_out" : "check_in";

    let sel = ctx.sb.from("hotel_bookings")
      .select("id, booking_no, status, guest_name, mobile, city, hotel_name, room_type, " +
              "rooms, guests, check_in, check_out, nights, sale_total, group_no")
      .eq("company_id", ctx.companyId)
      .gte(basis, r.from).lte(basis, r.to)
      .order(basis, { ascending: true })
      .limit(200);

    if (args?.status) sel = sel.eq("status", String(args.status));
    if (args?.guest) {
      const q = String(args.guest);
      sel = sel.or(`guest_name.ilike.%${q}%,mobile.ilike.%${q}%`);
    }

    const { data, error } = await sel;
    if (error) return fromError(error, "Could not read hotel bookings.");
    const rows = (data ?? []) as any[];
    const { rows: shown, total, truncated } = cap(rows);

    return ok(
      { period: r.label, basis, from: r.from, to: r.to, count: total, truncated, bookings: shown },
      { count: total, summary: `Hotels — ${total} ${basis === "check_in" ? "check-in" : "check-out"}(s) for ${r.label}`,
        link: basis === "check_in" ? "/hotels/checkin" : "/hotels/checkout" }
    );
  },
};

const visaGroups: AiTool = {
  name: "get_visa_groups",
  description:
    "Umrah visa groups: group number, name, pax, arrival/departure, visa status, BRN status and " +
    "workflow status. Use for group lookups and \"which groups are pending\".",
  kind: "read",
  perm: "visa.view",
  schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Part of the group number or group name." },
      when: WHEN,
      from: { type: "string", description: "Arrival from date, YYYY-MM-DD" },
      to: { type: "string", description: "Arrival to date, YYYY-MM-DD" },
      visa_status: { type: "string", description: "Filter by visa status." },
      any_date: { type: "boolean", description: "Ignore dates entirely — use with query to find one group." },
    },
    additionalProperties: false,
  },
  async run(args, ctx) {
    let sel = ctx.sb.from("umrah_groups")
      .select("id, group_no, group_name, pax, arrival_date, arrival_flight, departure_date, " +
              "visa_status, brn_status, workflow_status, package_status, total_nights")
      .eq("company_id", ctx.companyId)
      .order("arrival_date", { ascending: true })
      .limit(200);

    if (!args?.any_date && !args?.query) {
      const r = range(args);
      sel = sel.gte("arrival_date", r.from).lte("arrival_date", r.to);
    } else if (args?.from || args?.to) {
      if (args.from) sel = sel.gte("arrival_date", args.from);
      if (args.to) sel = sel.lte("arrival_date", args.to);
    }
    if (args?.query) {
      const q = String(args.query);
      sel = sel.or(`group_no.ilike.%${q}%,group_name.ilike.%${q}%`);
    }
    if (args?.visa_status) sel = sel.eq("visa_status", String(args.visa_status));

    const { data, error } = await sel;
    if (error) return fromError(error, "Could not read visa groups.");
    const rows = (data ?? []) as any[];
    const { rows: shown, total, truncated } = cap(rows);

    return ok({ count: total, truncated, groups: shown },
      { count: total, summary: `Visa — ${total} group(s)`, link: "/groups" });
  },
};

const transportReport: AiTool = {
  name: "get_transport_summary",
  description: "Transport operations summary for a period — the same figures as the Transport Reports screen.",
  kind: "read",
  perm: "transport.reports",
  schema: {
    type: "object",
    properties: {
      when: WHEN,
      from: { type: "string", description: "YYYY-MM-DD" },
      to: { type: "string", description: "YYYY-MM-DD" },
    },
    additionalProperties: false,
  },
  async run(args, ctx) {
    const r = range(args);
    const { data, error } = await ctx.sb.rpc("transport_reports", { p_from: r.from, p_to: r.to });
    if (error) return fromError(error, "Could not build the transport report.");
    return ok({ period: r.label, from: r.from, to: r.to, report: data },
      { summary: `Transport summary for ${r.label}`, link: "/transport/reports" });
  },
};

const arrivalCompliance: AiTool = {
  name: "get_arrival_compliance",
  description:
    "Groups arriving soon whose arrival service (transport / tafweej) is still NOT set — the " +
    "Arrival Service screen's own exception list. Every row returned needs handling; an empty " +
    "result means everything arriving in that window is covered.",
  kind: "read",
  perm: "transport.operations",
  schema: {
    type: "object",
    properties: { days: { type: "integer", description: "How many days ahead to look. Default 7." } },
    additionalProperties: false,
  },
  async run(args, ctx) {
    const days = Math.min(Math.max(num(args?.days) || 7, 1), 60);
    const { data, error } = await ctx.sb.rpc("arrival_compliance", { p_days: days });
    if (error) return fromError(error, "Could not read arrival compliance.");
    const rows = (data ?? []) as any[];
    const { rows: shown, total, truncated } = cap(rows);
    return ok({ days, count: total, truncated, groups: shown },
      { count: total, summary: `${total} group(s) arriving in the next ${days} days`, link: "/transport/arrivals" });
  },
};

const workflow: AiTool = {
  name: "get_workflow_summary",
  description: "The accounting/operations work-flow board counts — what is sitting at each stage.",
  kind: "read",
  perm: "accounting.view",
  schema: { type: "object", properties: {}, additionalProperties: false },
  async run(_args, ctx) {
    const { data, error } = await ctx.sb.rpc("workflow_summary");
    if (error) return fromError(error, "Could not read the work-flow summary.");
    return ok(data, { summary: "Work flow summary", link: "/accounting/workflow" });
  },
};

const notifications: AiTool = {
  name: "get_notifications",
  description: "The user's own ERP notification feed — unread first. Use for 'what have I missed'.",
  kind: "read",
  perm: "dashboard.view",
  schema: {
    type: "object",
    properties: { unread_only: { type: "boolean", description: "Only unread items." } },
    additionalProperties: false,
  },
  async run(args, ctx) {
    const { data, error } = await ctx.sb.rpc("notifications_feed");
    if (error) return fromError(error, "Could not read notifications.");
    let rows = (data ?? []) as any[];
    if (args?.unread_only) rows = rows.filter((r) => !r.read);
    const { rows: shown, total, truncated } = cap(rows, 25);
    return ok({ count: total, truncated, notifications: shown },
      { count: total, summary: `${total} notification(s)` });
  },
};

const openScreen: AiTool = {
  name: "open_screen",
  description:
    "Open an ERP screen for the user. Use it when they say 'open X', 'show me the X screen', or after " +
    "finding a record they will want to look at. Pass a route from the ERP itself — never invent one.",
  kind: "read",
  perm: "ai.use",
  schema: {
    type: "object",
    properties: {
      route: { type: "string", description: "An ERP path, e.g. /accounting/ledger?account=<id> or /transport/bookings." },
      reason: { type: "string", description: "One short line on what the user will see there." },
    },
    required: ["route"],
    additionalProperties: false,
  },
  async run(args, ctx) {
    const route = String(args?.route ?? "").trim();
    // Only in-app paths. An absolute URL would let a conversation navigate the
    // user off the ERP, so it is refused rather than sanitised.
    if (!route.startsWith("/") || route.startsWith("//")) {
      return fail("I can only open a screen inside the ERP.");
    }
    return ok({ opened: route, reason: args?.reason ?? null },
      { summary: `Opened ${route}`, link: route });
  },
};

export const OPERATIONS_TOOLS: AiTool[] = [
  transportBookings, hotelBookings, visaGroups,
  transportReport, arrivalCompliance, workflow, notifications, openScreen,
];
