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

import type { IconName } from "@/components/ui/Icon";

export interface CardDef {
  key: CardKey;
  label: string;
  hint: string;           // what the number means, shown to the admin picking cards
  href?: string;          // where the card drills through to
  icon: IconName;         // small category icon beside the card title — reuses the one app-wide icon set, never a new one
}

export const DASHBOARD_CARDS: CardDef[] = [
  { key: "cash_bank", label: "Cash & Bank", icon: "wallet",
    hint: "Balance across every cash and bank account", href: "/accounting/cash-bank" },
  { key: "cash_flow", label: "Cash Flow", icon: "trendUp",
    hint: "Where cash came from and went to this period, month by month, plus what is already due to arrive or leave. The Cash & Bank card shows the closing balance; this shows the movement and what's coming",
    href: "/accounting/cash-flow" },
  { key: "balance_sheet", label: "Balance Sheet", icon: "accounting",
    hint: "Assets, liabilities, equity and the retained result, with the difference that says whether the books balance",
    href: "/accounting/balance-sheet" },
  { key: "ar_ap", label: "A/R & A/P Balance", icon: "receipt",
    hint: "What customers owe and what is owed to suppliers, read off the LEDGER so car, visa, transport and hotel balances are all in it. Overdue covers only invoices and bills that carry a due date, so it is a floor rather than the whole of what is late",
    href: "/accounting/aging" },
  { key: "sales", label: "Sales", icon: "sales",
    hint: "Income booked this month and this year, and how many invoices this month", href: "/accounting/sales-report" },
  { key: "expenses", label: "Expenses", icon: "trendDown",
    hint: "Expense booked this month and this year", href: "/accounting/expenses" },
  { key: "pnl", label: "Profit & Loss", icon: "trendUp",
    hint: "The bottom line — gross profit, net profit and margin, month and year. Income and Expense have their own cards, so this one is the calculation those two combine into, not a repeat of either",
    href: "/accounting/profit-loss" },
  { key: "car_balances", label: "Car Customer Balances", icon: "car",
    hint: "Everything a car customer owes — instalments, the invoice advance AND the monthly service charge. Due (its date has arrived), Overdue (its month has ended), Total of the two, the customers' ledger balance, and what has been collected",
    href: "/car-sales/reports/outstanding" },
  { key: "pending_sales_orders", label: "Pending Sales Orders", icon: "sales",
    hint: "Sale Orders not yet turned into an invoice or a purchase order", href: "/accounting/sales/orders-report" },
  { key: "pending_purchase_orders", label: "Pending Purchase Orders", icon: "purchase",
    hint: "Purchase Orders not yet received against", href: "/accounting/purchases/orders-report" },
  { key: "order_status", label: "Order Status", icon: "inventory",
    hint: "Stock on hand plus what's on order, less what's committed to open sale orders — the same virtual-stock figure the Inventory report works out per item",
    href: "/stock/virtual" },
  { key: "so_advance_receipt", label: "Sale Order · Advance vs Receipt", icon: "receipt",
    hint: "Sale orders still awaiting their invoice — one leaves this card the moment a Car Invoice is raised from it. Advance is the one agreed on the order itself (Car Sales Details); Balance is the advance still to come in, advance minus received",
    href: "/accounting/sales/advance-vs-receipt" },
  { key: "purchase_vs_sale", label: "Purchase vs Sale", icon: "purchase",
    hint: "Inventory movement, not money: units purchased and sold this month, and how many are left — off the same stock ledger every Inventory report reads, goods and cars alike. Sales and Profit & Loss already carry the money and margin figures",
    href: "/accounting/purchase-vs-sale" },
  { key: "stock", label: "Stock", icon: "inventory",
    hint: "Quantity and value on hand", href: "/stock/valuation" },
  { key: "delivery_status", label: "Delivery Status", icon: "car",
    hint: "Sold vs delivered vs still to go out", href: "/car-sales/reports/delivery" },
  { key: "bookings", label: "Hotel Bookings", icon: "hotel",
    hint: "Hotel bookings by status, and today's movements", href: "/hotels/bookings" },

  // These came off the module dashboards when those were removed.
  { key: "approvals", label: "Pending Approvals", icon: "check",
    hint: "Vouchers waiting for authorisation", href: "/accounting/approvals" },
  { key: "pdc", label: "PDC Register", icon: "clock",
    hint: "Post-dated cheques pending, and how many fall due within 14 days", href: "/accounting/pdc" },
  { key: "car_contracts", label: "Car Contracts", icon: "car",
    hint: "Contracts total, active and completed, and their sale value", href: "/car-sales/contracts" },
  { key: "car_ownership", label: "Car Ownership", icon: "car",
    hint: "Vehicles transferred, Vista-owned and held", href: "/car-sales/vehicles" },
  { key: "hotel_financials", label: "Hotel Sales & Profit", icon: "hotel",
    hint: "Hotel sales against purchase, gross profit, payable and HCN status", href: "/hotels/reports" },
  { key: "brn_beds", label: "BRN Beds", icon: "store",
    hint: "Beds bought and reserved, and bed-night occupancy", href: "/inventory/brn" },
  { key: "brn_availability", label: "BRN Available Today", icon: "store",
    hint: "Beds free tonight in Makkah and Madinah, and today's movements", href: "/inventory/calendar" },
  { key: "brn_agreements", label: "BRN Agreements", icon: "store",
    hint: "Active agreements, those expiring within a week, and supplier outstanding", href: "/inventory/brn" },
  { key: "transport", label: "Transport", icon: "transport",
    hint: "Bookings pending, trips running, trips with no driver, revenue, and alerts — trips sitting in the wrong status because nobody pressed Picked Up or Complete", href: "/transport/operations" },
  { key: "visa_groups", label: "Visa Groups", icon: "visa",
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
