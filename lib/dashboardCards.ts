// ============================================================
// The dashboard's cards, in one register.
//
// Every card the business looks at lives on ONE dashboard (/dashboard) instead
// of being spread over a dashboard per module. Add a card here and it appears
// there and in the per-user card picker; there is nowhere else to register it.
//
// Access is the one place the "empty means unrestricted" convention is
// reversed: an admin sees every card, and everyone else sees only the cards
// ticked for them (profiles.dashboard_cards). A dashboard is where the whole
// company's money is visible at a glance, so it is opt-in, not opt-out.
// ============================================================

export type CardKey =
  | "cash_bank" | "ar_ap" | "sales" | "expenses" | "pnl"
  | "car_balances" | "pending_sales_orders" | "pending_purchase_orders"
  | "order_status" | "so_advance_receipt" | "purchase_vs_sale"
  | "stock" | "bookings" | "delivery_status";

export interface CardDef {
  key: CardKey;
  label: string;
  group: string;          // the heading it sits under
  hint: string;           // what the number means, shown to the admin picking cards
  href?: string;          // where the card drills through to
}

export const DASHBOARD_CARDS: CardDef[] = [
  // ── Money ────────────────────────────────────────────────────────────────
  { key: "cash_bank", label: "Cash & Bank", group: "Money",
    hint: "Balance across every cash and bank account", href: "/accounting/ledger" },
  { key: "ar_ap", label: "A/R & A/P Balance", group: "Money",
    hint: "Open customer and supplier balances, and what is overdue", href: "/accounting/aging" },
  { key: "sales", label: "Sales", group: "Money",
    hint: "Income booked this month and this year", href: "/accounting/profit-loss" },
  { key: "expenses", label: "Expenses", group: "Money",
    hint: "Expense booked this month and this year", href: "/accounting/profit-loss" },
  { key: "pnl", label: "Profit & Loss", group: "Money",
    hint: "Income less expense, month and year", href: "/accounting/profit-loss" },
  { key: "car_balances", label: "Car Customer Balances", group: "Money",
    hint: "Instalments outstanding, overdue and due this month", href: "/car-sales/contracts" },

  // ── Orders ───────────────────────────────────────────────────────────────
  { key: "pending_sales_orders", label: "Pending Sales Orders", group: "Orders",
    hint: "Sale Orders not yet turned into an invoice or a purchase order", href: "/accounting/sales/orders" },
  { key: "pending_purchase_orders", label: "Pending Purchase Orders", group: "Orders",
    hint: "Purchase Orders not yet received against", href: "/accounting/purchases/orders" },
  { key: "order_status", label: "Order Status", group: "Orders",
    hint: "Ordered vs stock on hand vs on order, and the balance", href: "/accounting/workflow" },
  { key: "so_advance_receipt", label: "Sale Order · Advance vs Receipt", group: "Orders",
    hint: "Order value against the advance and the money actually received", href: "/accounting/sales/orders" },

  // ── Trade ────────────────────────────────────────────────────────────────
  { key: "purchase_vs_sale", label: "Purchase vs Sale", group: "Trade",
    hint: "What was bought against what was sold, month and year", href: "/accounting/sales/invoices" },
  { key: "stock", label: "Stock", group: "Trade",
    hint: "Quantity and value on hand", href: "/stock/valuation" },
  { key: "delivery_status", label: "Delivery Status", group: "Trade",
    hint: "Sold vs delivered vs still to go out", href: "/car-sales/vehicles" },

  // ── Operations ───────────────────────────────────────────────────────────
  { key: "bookings", label: "Bookings", group: "Operations",
    hint: "Hotel bookings by status, and today's movements", href: "/hotels/bookings" },
];

export const CARD_GROUPS = Array.from(new Set(DASHBOARD_CARDS.map((c) => c.group)));
export const ALL_CARD_KEYS = DASHBOARD_CARDS.map((c) => c.key);

/**
 * `cards` is what staff_access() returned: the string "all" for an admin, or a
 * {key: true} map for everyone else. An empty map means NO cards — the
 * dashboard is opt-in, unlike the module and screen-rights maps.
 */
export type CardAccess = "all" | Record<string, boolean>;

export function canSeeCard(cards: CardAccess | null | undefined, key: string): boolean {
  if (cards === "all") return true;
  if (!cards || typeof cards !== "object") return false;
  return !!cards[key];
}

export function visibleCards(cards: CardAccess | null | undefined): CardDef[] {
  return DASHBOARD_CARDS.filter((c) => canSeeCard(cards, c.key));
}
