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
  | "cash_bank" | "cash_flow" | "ar_ap" | "sales" | "expenses" | "pnl" | "balance_sheet"
  | "car_balances" | "pending_sales_orders" | "pending_purchase_orders"
  | "order_status" | "so_advance_receipt" | "purchase_vs_sale"
  | "stock" | "bookings" | "delivery_status"
  // Absorbed from the module dashboards, which no longer exist.
  | "approvals" | "pdc" | "car_contracts" | "car_ownership"
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
  { key: "cash_flow", label: "Cash Flow",
    hint: "What moved through cash and bank — in, out and net, month and year. The Cash & Bank card shows the closing balance; this shows the movement",
    href: "/accounting/ledger" },
  { key: "balance_sheet", label: "Balance Sheet",
    hint: "Assets, liabilities, equity and the retained result, with the difference that says whether the books balance",
    href: "/accounting/balance-sheet" },
  { key: "ar_ap", label: "A/R & A/P Balance",
    hint: "What customers owe and what is owed to suppliers, read off the LEDGER so car, visa, transport and hotel balances are all in it. Overdue covers only invoices and bills that carry a due date, so it is a floor rather than the whole of what is late",
    href: "/accounting/aging" },
  { key: "sales", label: "Sales",
    hint: "Income booked this month and this year", href: "/accounting/profit-loss" },
  { key: "expenses", label: "Expenses",
    hint: "Expense booked this month and this year", href: "/accounting/profit-loss" },
  { key: "pnl", label: "Profit & Loss",
    hint: "Income less expense, month and year", href: "/accounting/profit-loss" },
  { key: "car_balances", label: "Car Customer Balances",
    hint: "Everything a car customer owes — instalments, the invoice advance AND the monthly service charge. Due (its date has arrived), Overdue (its month has ended), Total of the two, the customers' ledger balance, and what has been collected",
    href: "/car-sales/contracts" },
  { key: "pending_sales_orders", label: "Pending Sales Orders",
    hint: "Sale Orders not yet turned into an invoice or a purchase order", href: "/accounting/sales/orders" },
  { key: "pending_purchase_orders", label: "Pending Purchase Orders",
    hint: "Purchase Orders not yet received against", href: "/accounting/purchases/orders" },
  { key: "order_status", label: "Order Status",
    hint: "Ordered vs stock on hand vs on order, and the balance", href: "/accounting/workflow" },
  { key: "so_advance_receipt", label: "Sale Order · Advance vs Receipt",
    hint: "Sale orders still awaiting their invoice — one leaves this card the moment a Car Invoice is raised from it. Advance is the one agreed on the order itself (Car Sales Details); Balance is the advance still to come in, advance minus received",
    href: "/accounting/sales/orders" },
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
