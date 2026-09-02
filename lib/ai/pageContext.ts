import type { PageContext } from "@/lib/ai/types";

// ============================================================
// What the user is looking at.
//
// "Why is this balance so high?" only means something if she knows what
// "this" is. This turns the current ERP route into a small, named context:
// the screen, and the record on it.
//
// It sends an id and a type — never data. The server re-reads the record
// through the ordinary tools under the user's own session, so a browser that
// lied about the id gets exactly what that user was allowed to see anyway.
// The context steers her attention; it never grants access.
// ============================================================

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Route → what a record on it is. Ordered longest-prefix-first at match time.
// `param` reads the id from a query string; otherwise it is the last path
// segment. The entity names match what the tools call things, so the model
// does not have to translate.
const ROUTES: { prefix: string; screen: string; entity?: string; param?: string }[] = [
  { prefix: "/accounting/ledger", screen: "Ledger / Statement", entity: "ledger_account", param: "account" },
  { prefix: "/accounting/aging", screen: "Aging (AR/AP)" },
  { prefix: "/accounting/vouchers", screen: "Voucher", entity: "journal_entry" },
  { prefix: "/accounting/journal", screen: "Voucher Register", entity: "journal_entry" },
  { prefix: "/accounting/trade", screen: "Trade document", entity: "trade_document" },
  { prefix: "/accounting/visa-invoices", screen: "Visa Invoices", entity: "visa_invoice" },
  { prefix: "/accounting/approvals", screen: "Approval Inbox" },
  { prefix: "/accounting/trial-balance", screen: "Trial Balance" },
  { prefix: "/accounting/profit-loss", screen: "Profit & Loss" },
  { prefix: "/accounting/balance-sheet", screen: "Balance Sheet" },
  { prefix: "/accounting/workflow", screen: "Work Flow" },
  { prefix: "/accounting/audit", screen: "Audit Trail" },
  { prefix: "/accounting", screen: "Accounting" },
  { prefix: "/transport/bookings", screen: "Transport Booking", entity: "transport_booking" },
  { prefix: "/transport/operations", screen: "Transport Operations" },
  { prefix: "/transport/arrivals", screen: "Arrival Service" },
  { prefix: "/transport/reports", screen: "Transport Reports" },
  { prefix: "/transport", screen: "Transport" },
  { prefix: "/hotels/bookings", screen: "Hotel Booking", entity: "hotel_booking" },
  { prefix: "/hotels/checkin", screen: "Hotel Check-in / Arrivals" },
  { prefix: "/hotels/checkout", screen: "Hotel Check-out" },
  { prefix: "/hotels", screen: "Hotels" },
  { prefix: "/groups", screen: "Visa Group", entity: "umrah_group" },
  { prefix: "/visa/invoices", screen: "Visa Invoices" },
  { prefix: "/parties", screen: "Customer / Supplier", entity: "party" },
  { prefix: "/inventory", screen: "BRN Inventory" },
  { prefix: "/car-sales", screen: "Car Sales" },
  { prefix: "/stock", screen: "Inventory" },
  { prefix: "/purchase", screen: "Purchase" },
  { prefix: "/dashboard", screen: "Dashboard" },
];

/**
 * Build the context for a route. Returns null on /ai itself — she is not
 * "looking at" her own screen, and saying so would only confuse her.
 */
export function resolvePageContext(pathname: string, search?: URLSearchParams | null): PageContext | null {
  if (!pathname || pathname === "/ai" || pathname.startsWith("/ai/")) return null;

  let best: (typeof ROUTES)[number] | null = null;
  for (const r of ROUTES) {
    if ((pathname === r.prefix || pathname.startsWith(r.prefix + "/")) &&
        (!best || r.prefix.length > best.prefix.length)) {
      best = r;
    }
  }
  if (!best) return { route: pathname };

  let entityId: string | null = null;
  if (best.entity) {
    if (best.param) {
      const v = search?.get(best.param);
      if (v && UUID.test(v)) entityId = v;
    } else {
      // A detail route ends in the record's id. "new" and "edit" are not ids.
      const last = pathname.split("/").filter(Boolean).pop() ?? "";
      if (UUID.test(last)) entityId = last;
    }
  }

  return {
    route: pathname,
    entityType: entityId ? best.entity ?? null : null,
    entityId,
    screen: best.screen,
  };
}

/** Server-side sanitiser. The browser sends this, so none of it is trusted. */
export function sanitizePageContext(raw: unknown): PageContext | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const route = typeof o.route === "string" ? o.route : "";
  // In-app paths only, and short enough that nothing can be smuggled through
  // the field as a wall of instructions.
  if (!route.startsWith("/") || route.startsWith("//") || route.length > 200) return null;

  const entityId = typeof o.entityId === "string" && UUID.test(o.entityId) ? o.entityId : null;
  const entityType =
    typeof o.entityType === "string" && /^[a-z_]{1,40}$/.test(o.entityType) ? o.entityType : null;
  const screen =
    typeof o.screen === "string" && o.screen.length <= 60 ? o.screen.replace(/[\r\n]/g, " ") : null;

  return { route, entityType: entityId ? entityType : null, entityId, screen };
}
