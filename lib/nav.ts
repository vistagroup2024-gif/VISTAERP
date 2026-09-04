import type { IconName } from "@/components/ui/Icon";
import { docForPath, hasDocRight, type DocRightsMap } from "@/lib/docRights";

// Shared navigation model — the single source of truth for both the Sidebar and
// the global search. Data only (no JSX), so it can be imported anywhere.

// `perm` (any-of) on an Item gates that link individually. Omit to always show.
export interface NavItem { href: string; label: string; icon?: IconName; perm?: string[]; exact?: boolean }
// `perm` (any-of) gates the whole module. Omit to always show.
// `section` nests the module under a parent heading in the sidebar (see SECTIONS).
export interface NavGroup { label: string; icon: IconName; items: NavItem[]; perm?: string[]; section?: string }

// Parent headings that collect several modules. A section is shown only when at
// least one of its modules survives the permission filter, and it keeps its own
// order — the modules appear in the order they are declared in GROUPS.
export interface NavSection { label: string; icon: IconName }
export const SECTIONS: NavSection[] = [
  { label: "Umrah", icon: "visa" },
  { label: "Trading", icon: "car" },
  { label: "Settings", icon: "settings" },
];

export interface StaffNavAccess {
  unrestricted: boolean;
  permissions: Record<string, boolean>;
  // Per-screen rights (the Access tab). A link whose screen the user has no
  // "Access" right for is dropped from the menu and the search index.
  isAdmin?: boolean;
  docRights?: DocRightsMap;
}

export const DASHBOARD: NavItem = { href: "/dashboard", label: "Dashboard", icon: "dashboard" };

/**
 * Screens taken out of the sidebar but LEFT BUILT AND WORKING. They keep their
 * routes, their data and their code.
 *
 * If something like one of these is wanted again, UNHIDE IT and carry on from
 * what is here — move the entry back into its group in GROUPS below. Do not
 * build a new screen alongside it: that leaves two half-versions of the same
 * idea and the data split between them.
 *
 *   Service Catalog  /sales/catalog  — the price list of sellable services
 *                                      (visa, transport, hotel, ziyarat) that
 *                                      booking lines are priced from.
 *   Visa Tracking    /sales/visas    — per-passenger visa status on a booking
 *                                      (applied / issued / rejected).
 *   Packages         /packages       — pre-built Umrah packages sold as one
 *                                      price; also read by the B2B agent portal.
 *   Invoices         /invoices       — the customer invoice the booking flow
 *                                      raises by itself once a booking is
 *                                      confirmed. Read-only, never typed.
 *                                      NOT the Sales Invoice voucher, and not
 *                                      Accounting's Invoice / Bill.
 */
export const HIDDEN_ITEMS: NavItem[] = [
  { href: "/sales/catalog", label: "Service Catalog", perm: ["sales.view"] },
  { href: "/sales/visas", label: "Visa Tracking", perm: ["sales.view"] },
  { href: "/packages", label: "Packages", perm: ["sales.view"] },
  { href: "/invoices", label: "Invoices", perm: ["sales.view"] },
];

// The modules, and every screen in them. Some of these screens are shown by the
// header's Transactions menu instead of the sidebar (see inTransactions below) —
// they are still declared here, because this is the one place that says what a
// screen is called, which permission opens it, and that the global search should
// find it. Nothing is deleted from here to move it into the header.
export const GROUPS: NavGroup[] = [
  { label: "Visa", icon: "visa", section: "Umrah", perm: ["visa.view", "visa.package_update", "visa.invoices"], items: [
    { href: "/groups", label: "Visa Groups", perm: ["visa.view"] },
    { href: "/visa/invoices", label: "Visa Invoices", perm: ["visa.invoices"] },
    { href: "/groups/package-updates", label: "Package Updates", perm: ["visa.package_update"] },
  ] },
  { label: "BRN Inventory", icon: "inventory", section: "Umrah", perm: ["brn.view", "brn.planning"], items: [
    { href: "/inventory/brn", label: "BRN List", perm: ["brn.view"] },
    { href: "/inventory/archived", label: "Archived BRNs", perm: ["brn.view"] },
    { href: "/inventory/calendar", label: "Daily Calendar", perm: ["brn.view"] },
    { href: "/inventory/consume", label: "Consume Inventory", perm: ["brn.add", "brn.edit"] },
    { href: "/inventory/planning", label: "Purchase Planning", perm: ["brn.planning"] },
    { href: "/inventory/history", label: "History", perm: ["brn.view"] },
  ] },
  { label: "Hotels", icon: "hotel", section: "Umrah", perm: ["hotels.masters", "hotels.bookings", "hotels.suppliers", "hotels.reports"], items: [
    { href: "/hotels/bookings", label: "Hotel Bookings", perm: ["hotels.bookings"] },
    { href: "/hotels/nusuk", label: "Nusuk Agreements", perm: ["hotels.bookings"] },
    { href: "/hotels/checkin", label: "Check-in / Arrivals", perm: ["hotels.bookings"] },
    { href: "/hotels/checkout", label: "Check-out / Completed", perm: ["hotels.bookings"] },
    { href: "/hotels/suppliers", label: "Suppliers", perm: ["hotels.suppliers"] },
    { href: "/hotels", label: "Hotel Master", perm: ["hotels.masters"], exact: true },
    { href: "/hotels/reports", label: "Reports", perm: ["hotels.reports"] },
  ] },
  { label: "Transport", icon: "transport", section: "Umrah", perm: ["transport.masters", "transport.bookings", "transport.operations", "transport.vehicles", "transport.reports", "transport.trip_ledger"], items: [
    { href: "/transport/operations", label: "Operations", perm: ["transport.operations", "transport.driver_assign"] },
    { href: "/transport/arrivals", label: "Arrival Service", perm: ["transport.operations", "transport.bookings"] },
    { href: "/transport/bookings", label: "Bookings", perm: ["transport.bookings"] },
    { href: "/transport/vehicles", label: "Vehicles", perm: ["transport.vehicles"] },
    { href: "/transport/routes", label: "Routes", perm: ["transport.masters"] },
    { href: "/transport/rates", label: "Rate Master", perm: ["transport.masters"] },
    { href: "/transport/packages", label: "Packages", perm: ["transport.masters"] },
    { href: "/transport/drivers", label: "Drivers", perm: ["transport.masters", "transport.vehicles"] },
    { href: "/transport/fleet", label: "Fleet Health", perm: ["transport.operations", "transport.driver_assign"] },
    { href: "/transport/vendors", label: "Vendors", perm: ["transport.masters"] },
    { href: "/transport/expenses", label: "Expenses", perm: ["transport.masters", "transport.reports"] },
    { href: "/transport/messages", label: "Confirmations", perm: ["transport.operations"] },
    { href: "/transport/reports", label: "Reports", perm: ["transport.reports"] },
    { href: "/transport/reports/ledger", label: "Trip Ledger", perm: ["transport.trip_ledger"] },
  ] },
  { label: "Car Sales", icon: "car", section: "Trading", perm: ["carsales.view"], items: [
    { href: "/car-sales/alerts", label: "Alerts", perm: ["carsales.view", "carsales.reports"] },
    { href: "/car-sales/vehicles", label: "Vehicles / Stock", perm: ["carsales.vehicles", "carsales.view"] },
    { href: "/car-sales/contracts", label: "Car Invoices", perm: ["carsales.installments", "carsales.sales"] },
    { href: "/car-sales/service-charges", label: "Monthly Charges", perm: ["carsales.charges"] },
    { href: "/car-sales/commissions", label: "Commissions", perm: ["carsales.ownership", "carsales.sales"] },
    { href: "/car-sales/reports", label: "Reports", perm: ["carsales.reports"] },
  ] },
  { label: "Sales", icon: "sales", perm: ["sales.view", "parties.manage"], items: [
    // Service Catalog, Visa Tracking, Packages and Invoices used to sit here.
    // They are hidden, not removed — see HIDDEN_ITEMS above. Move the entry
    // back here to unhide one; do not build a replacement for it.
    { href: "/accounting/sales/quotations", label: "Sales Quotation", perm: ["sales.view"] },
    { href: "/accounting/sales/orders", label: "Sale Order", perm: ["sales.view"] },
    { href: "/accounting/sales/invoices", label: "Sales Invoice", perm: ["sales.view"] },
    { href: "/accounting/sales/delivery-notes", label: "Delivery Note", perm: ["sales.view"] },
    { href: "/accounting/sales/returns", label: "Sales Return", perm: ["sales.view"] },
  ] },
  { label: "Purchase", icon: "purchase", perm: ["purchase.view"], items: [
    { href: "/purchase/bills", label: "Supplier Bills" },
    { href: "/accounting/purchases/orders", label: "Purchase Order" },
    { href: "/accounting/purchases/vouchers", label: "Purchase Voucher" },
    { href: "/accounting/purchases/mrn", label: "Material Receipt (MRN)" },
    { href: "/accounting/purchases/returns", label: "Purchase Return" },
  ] },
  { label: "Accounting", icon: "accounting", perm: ["accounting.view"], items: [
    { href: "/accounting/workflow", label: "Work Flow" },
    { href: "/accounting/receipts", label: "Receipt" },
    { href: "/accounting/payments", label: "Payment" },
    { href: "/accounting/contra", label: "Contra" },
    { href: "/accounting/petty-cash", label: "Petty Cash" },
    { href: "/accounting/journal/new", label: "Journal Entry" },
    { href: "/accounting/recurring", label: "Recurring Vouchers" },
    { href: "/accounting/bank", label: "Bank Reconciliation" },
    { href: "/accounting/invoices", label: "Invoice / Bill" },
    { href: "/accounting/visa-invoices", label: "Visa Invoices" },
    { href: "/accounting/transport-invoices", label: "Transport Invoices" },
    { href: "/accounting/hotel-invoices", label: "Hotel Invoices" },
    { href: "/accounting/pdc", label: "PDC Register" },
    { href: "/accounting/approvals", label: "Approval Inbox" },
    { href: "/accounting/aging", label: "Aging (AR/AP)" },
    { href: "/accounting/ledger", label: "Ledger / Statement" },
    { href: "/accounting/journal", label: "Voucher Register" },
    { href: "/accounting/trial-balance", label: "Trial Balance" },
    { href: "/accounting/targets", label: "Targets & Budget" },
    { href: "/accounting/sales-costing", label: "Sales Costing" },
    { href: "/accounting/profit-loss", label: "Profit & Loss" },
    { href: "/accounting/balance-sheet", label: "Balance Sheet" },
    { href: "/accounting/vat", label: "VAT Return" },
    { href: "/accounting/assets", label: "Fixed Assets" },
    { href: "/accounting/close", label: "Year-End Close" },
    { href: "/accounting/rules", label: "Voucher Authorisation" },
    { href: "/accounting/audit", label: "Audit Trail" },
  ] },
  // Inventory (goods). Mirrors the order of the desktop Inventory menu; the BRN
  // bed inventory under Umrah Package is a different thing and keeps its name.
  { label: "Inventory", icon: "store", perm: ["accounting.view"], items: [
    { href: "/stock/documents", label: "Document Processing" },
    { href: "/stock/query", label: "Query" },
    { href: "/stock/ledger", label: "Stock Ledger" },
    { href: "/stock/opening", label: "Opening Stocks Register" },
    { href: "/stock/statement", label: "Stock Statement" },
    { href: "/stock/movement", label: "Stock Movement" },
    { href: "/stock/multilevel", label: "Multi-level Stock Movement Report" },
    { href: "/stock/virtual", label: "Virtual Stock Analysis" },
    { href: "/stock/valuation", label: "Stock Valuation" },
    { href: "/stock/abc", label: "ABC Analysis" },
    { href: "/stock/ageing", label: "Ageing Analysis" },
    { href: "/stock/reorder", label: "Reorder Report" },
    { href: "/stock/fast-moving", label: "Fast Moving Items" },
    { href: "/stock/slow-moving", label: "Slow Moving Items" },
    { href: "/stock/peak-low", label: "Peak/Low Balances" },
    { href: "/stock/indents", label: "Raise Indents for Items with Low Stock" },
    { href: "/stock/warehouses", label: "Warehouses" },
  ] },
  { label: "Payroll / HR", icon: "payroll", perm: ["accounting.view"], items: [
    { href: "/hr/employees", label: "Employees" },
    { href: "/hr/payroll", label: "Payroll" },
  ] },
  { label: "Masters", icon: "masters", section: "Settings", perm: ["accounting.view"], items: [
    { href: "/accounting/accounts", label: "Chart of Accounts" },
    { href: "/accounting/masters/products", label: "Product Tree" },
    { href: "/accounting/masters/tag-areas", label: "Tag Area" },
    { href: "/accounting/masters/cost-centers", label: "Cost Center" },
    { href: "/accounting/masters/car-expenses", label: "Car Purchase Expense" },
    { href: "/accounting/masters/currencies", label: "Currencies" },
    { href: "/accounting/masters/salespersons", label: "Salespersons & Commission" },
  ] },
  { label: "Users", icon: "users", section: "Settings", perm: ["users.view", "users.manage_roles"], items: [
    { href: "/settings/users", label: "Staff Users" },
    { href: "/settings/agents", label: "B2B Agents" },
    { href: "/settings/roles", label: "Roles & Permissions" },
  ] },
  { label: "Company", icon: "settings", section: "Settings", perm: ["system.companies", "system.config", "system.masters"], items: [
    { href: "/settings/companies", label: "Companies" },
  ] },
  { label: "Notifications", icon: "bell", section: "Settings", perm: ["dashboard.view"], items: [
    { href: "/settings/notifications", label: "Phone Notifications" },
  ] },
];

// ── The header's "Transactions" menu ────────────────────────────────────────
//
// The desktop accounting menu, two levels deep: Cash and Bank / Purchases /
// Sales / Journals / Stocks, each opening the vouchers that belong to it. It is
// a second way into screens that already exist — everything here is also in the
// sidebar, and NOTHING here is new.
//
// That is why a submenu is a list of HREFs rather than of labels: the label and
// the permission are read back out of GROUPS by navItemFor(). An href that no
// longer exists in the sidebar drops out of the menu by itself, and a screen can
// never appear here under a name it does not have there.
//
// Focus's menu also carries Define Cheque Series, Cancel Cheque, Service
// Receipt, purchase Quotations, Qurbani PV, PV Other, Gain/Loss Adjustment,
// Qurbani Invoice, Percentage Definition, Air Ticket Invoice, Debit/Credit
// Notes, Opening Balances and the whole Manufacturing branch. None of those is
// built here, so none of them is listed — a menu entry pointing at nothing is
// worse than a missing one.
export interface QuickGroupDef { label: string; icon: IconName; hrefs: string[] }

// Screens reached from another screen rather than from the sidebar, so they have
// no GROUPS entry to read a label and a permission out of.
const EXTRA_ITEMS: NavItem[] = [
  { href: "/stock/documents/movement", label: "Stock Receipt / Issue / Adjustment", perm: ["accounting.view"] },
];

/** The sidebar's own entry for a route — label and permission included, so the
 *  header cannot drift from the menu or invent a screen. */
export function navItemFor(href: string): NavItem | null {
  for (const g of GROUPS) for (const it of g.items) if (it.href === href) return { ...it, perm: it.perm ?? g.perm };
  return EXTRA_ITEMS.find((i) => i.href === href) ?? null;
}

export const TRANSACTIONS: QuickGroupDef[] = [
  { label: "Cash and Bank", icon: "accounting", hrefs: [
    "/accounting/receipts",
    "/accounting/payments",
    "/accounting/petty-cash",
    "/accounting/contra",
    // One register for both post-dated cheque receipts and payments.
    "/accounting/pdc",
    "/accounting/bank",
  ] },
  { label: "Purchases", icon: "purchase", hrefs: [
    "/accounting/purchases/vouchers",
    "/accounting/purchases/returns",
    "/accounting/purchases/orders",
    "/accounting/purchases/mrn",
    // Focus's "Bill Record".
    "/purchase/bills",
  ] },
  { label: "Sales", icon: "sales", hrefs: [
    "/accounting/sales/invoices",
    "/accounting/sales/returns",
    "/accounting/sales/orders",
    "/accounting/sales/quotations",
    "/accounting/sales/delivery-notes",
    "/accounting/transport-invoices",
    "/car-sales/contracts",
    "/car-sales/service-charges",
    "/accounting/hotel-invoices",
    "/accounting/visa-invoices",
    // Focus's "Route Fares" and "Sales Targets".
    "/transport/rates",
    "/accounting/targets",
  ] },
  { label: "Journals", icon: "accounting", hrefs: [
    "/accounting/journal/new",
    "/accounting/invoices",
    "/accounting/recurring",
    "/hr/payroll",
  ] },
  { label: "Stocks", icon: "store", hrefs: [
    // Receipt, issue, adjustment and warehouse transfer are one screen here.
    "/stock/documents/movement",
    "/stock/documents",
    "/stock/opening",
    "/stock/warehouses",
  ] },
];

/** Every route the Transactions menu carries. */
const TRANSACTION_HREFS = new Set(TRANSACTIONS.flatMap((g) => g.hrefs));

/**
 * Is this screen reached from the header's Transactions menu?
 *
 * The SIDEBAR uses this to leave those screens out: a voucher belongs in one
 * menu, not two. They stay in GROUPS all the same — that is where their label,
 * their module permission and their place in the global search live, and it is
 * what navItemFor() reads — so this is the only line that decides which menu
 * shows them, and the two can never disagree about what a screen is called or
 * who may open it.
 */
export function inTransactions(href: string): boolean {
  return TRANSACTION_HREFS.has(href);
}

// Quick-access bar in the header: the transactions menu and the ledger are
// opened many times a day, so they get a permanent spot instead of living three
// clicks deep in the Accounting group.
export const QUICK_MENU: { label: string; icon: IconName; perm?: string[]; href?: string; items?: NavItem[]; groups?: QuickGroupDef[] }[] = [
  // No `perm` of its own: each submenu is filtered item by item below, and the
  // button is dropped when nothing survives — so a Car Sales user still gets the
  // one Sales entry they may open.
  { label: "Transactions", icon: "accounting", groups: TRANSACTIONS },
  { label: "Ledger", icon: "accounting", perm: ["accounting.view"], href: "/accounting/ledger" },
];

/** Same permission test the sidebar and search use. */
export function navAllows(access: StaffNavAccess | undefined, perm?: string[]) {
  return !perm || !access || access.unrestricted || perm.some((k) => access.permissions[k]);
}

/** A link also needs the "Access" right of the screen it points at, if it has one. */
export function navAllowsItem(access: StaffNavAccess | undefined, item: NavItem) {
  if (!navAllows(access, item.perm)) return false;
  if (!access?.docRights) return true;
  const doc = docForPath(item.href);
  return !doc || hasDocRight(access.docRights, !!access.isAdmin, doc, "access");
}

/** A Transactions submenu, resolved against GROUPS and filtered to what this
 *  user may open. Groups that come back empty are dropped by the caller. */
export function quickGroups(defs: QuickGroupDef[] | undefined, access?: StaffNavAccess): { label: string; icon: IconName; items: NavItem[] }[] {
  if (!defs) return [];
  return defs
    .map((g) => ({
      label: g.label,
      icon: g.icon,
      items: g.hrefs
        .map(navItemFor)
        .filter((i): i is NavItem => !!i)
        .filter((i) => navAllowsItem(access, i)),
    }))
    .filter((g) => g.items.length > 0);
}

export function searchIndex(access?: StaffNavAccess): { label: string; href: string; group: string; icon: IconName }[] {
  const out: { label: string; href: string; group: string; icon: IconName }[] = [];
  const allow = (perm?: string[]) => !perm || !access || access.unrestricted || perm.some((k) => access.permissions[k]);
  if (allow(["dashboard.view"])) out.push({ label: "Dashboard", href: "/dashboard", group: "General", icon: "dashboard" });
  for (const g of GROUPS) {
    if (!allow(g.perm)) continue;
    for (const it of g.items) if (navAllowsItem(access, it)) out.push({ label: it.label, href: it.href, group: g.label, icon: g.icon });
  }
  return out;
}
