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
  | "stock" | "bookings" | "delivery_status"
  // Absorbed from the module dashboards, which no longer exist.
  | "approvals" | "pdc" | "car_contracts" | "car_service_charges" | "car_ownership"
  | "hotel_financials" | "brn_beds" | "brn_availability" | "brn_agreements"
  | "transport" | "visa_groups";

export interface CardDef {
  key: CardKey;
  label: string;
  hint: string;           // what the number means, shown to the admin picking cards
  href?: string;          // where the card drills through to
}

export const DASHBOARD_CARDS: CardDef[] = [
  { key: "cash_bank", label: "Cash & Bank",
    hint: "Balance across every cash and bank account", href: "/accounting/ledger" },
  { key: "ar_ap", label: "A/R & A/P Balance",
    hint: "Open customer and supplier balances, and what is overdue", href: "/accounting/aging" },
  { key: "sales", label: "Sales",
    hint: "Income booked this month and this year", href: "/accounting/profit-loss" },
  { key: "expenses", label: "Expenses",
    hint: "Expense booked this month and this year", href: "/accounting/profit-loss" },
  { key: "pnl", label: "Profit & Loss",
    hint: "Income less expense, month and year", href: "/accounting/profit-loss" },
  { key: "car_balances", label: "Car Customer Balances",
    hint: "Instalments outstanding, overdue and due this month", href: "/car-sales/contracts" },
  { key: "pending_sales_orders", label: "Pending Sales Orders",
    hint: "Sale Orders not yet turned into an invoice or a purchase order", href: "/accounting/sales/orders" },
  { key: "pending_purchase_orders", label: "Pending Purchase Orders",
    hint: "Purchase Orders not yet received against", href: "/accounting/purchases/orders" },
  { key: "order_status", label: "Order Status",
    hint: "Ordered vs stock on hand vs on order, and the balance", href: "/accounting/workflow" },
  { key: "so_advance_receipt", label: "Sale Order · Advance vs Receipt",
    hint: "Order value against the advance and the money actually received", href: "/accounting/sales/orders" },
  { key: "purchase_vs_sale", label: "Purchase vs Sale",
    hint: "What was bought against what was sold, month and year", href: "/accounting/sales/invoices" },
  { key: "stock", label: "Stock",
    hint: "Quantity and value on hand", href: "/stock/valuation" },
  { key: "delivery_status", label: "Delivery Status",
    hint: "Sold vs delivered vs still to go out", href: "/car-sales/vehicles" },
  { key: "bookings", label: "Bookings",
    hint: "Hotel bookings by status, and today's movements", href: "/hotels/bookings" },

  // These came off the module dashboards when those were removed.
  { key: "approvals", label: "Pending Approvals",
    hint: "Vouchers waiting for authorisation", href: "/accounting/approvals" },
  { key: "pdc", label: "PDC Register",
    hint: "Post-dated cheques pending, and how many fall due within 14 days", href: "/accounting/pdc" },
  { key: "car_contracts", label: "Car Contracts",
    hint: "Contracts total, active and completed, and their sale value", href: "/car-sales/contracts" },
  { key: "car_service_charges", label: "Car Monthly Charges",
    hint: "Service charges this month, outstanding and overdue", href: "/car-sales/service-charges" },
  { key: "car_ownership", label: "Car Ownership",
    hint: "Vehicles transferred, Vista-owned and held", href: "/car-sales/vehicles" },
  { key: "hotel_financials", label: "Hotel Sales & Profit",
    hint: "Hotel sales against purchase, gross profit, payable and HCN status", href: "/hotels/reports" },
  { key: "brn_beds", label: "BRN Beds",
    hint: "Beds bought and reserved, and bed-night occupancy", href: "/inventory/brn" },
  { key: "brn_availability", label: "BRN Available Today",
    hint: "Beds free tonight in Makkah and Madinah, and today's movements", href: "/inventory/calendar" },
  { key: "brn_agreements", label: "BRN Agreements",
    hint: "Active agreements, those expiring within a week, and supplier outstanding", href: "/inventory/brn" },
  { key: "transport", label: "Transport",
    hint: "Bookings pending, trips running, trips with no driver, and revenue", href: "/transport/operations" },
  { key: "visa_groups", label: "Visa Groups",
    hint: "Groups in process, issued, and waiting on BRN", href: "/groups" },
];

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
