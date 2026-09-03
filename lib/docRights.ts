// ============================================================
// Per-screen rights — the "Access" tab of the old accounting software.
//
// The permission catalog (lib/staffPermissions.ts) says which MODULES a user
// may open. This says what they may DO on each voucher and report inside them:
// open it, enter one, change one, delete one, print one, and whether they may
// touch documents somebody else entered or that have already been authorised.
//
// Stored on profiles.doc_rights as {docKey: {right: true}}. An EMPTY map means
// every screen and every right — same convention as permissions — so nothing
// changes for a user until an admin ticks something.
// ============================================================

export type DocRight =
  | "access" | "create" | "edit" | "delete" | "print" | "edit_others" | "edit_authorized";

export const RIGHT_LABEL: Record<DocRight, string> = {
  access: "Access",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
  print: "Print",
  edit_others: "Edit documents entered by other users",
  edit_authorized: "Edit documents already authorised",
};

export const ALL_DOC_RIGHTS: DocRight[] = Object.keys(RIGHT_LABEL) as DocRight[];

// What a data-entry voucher can carry, and the shorter set a report screen can.
export const VOUCHER_RIGHTS: DocRight[] = ["access", "create", "edit", "delete", "print", "edit_others", "edit_authorized"];
export const REPORT_RIGHTS: DocRight[] = ["access", "print"];
export const MASTER_RIGHTS: DocRight[] = ["access", "create", "edit", "delete", "print"];

// `href` is the screen's home route; `hrefs` lists any further routes that are
// the same screen for rights purposes (a report that got split across pages).
export interface DocNode { key: string; label: string; rights: DocRight[]; href?: string; hrefs?: string[] }
export interface DocGroup { group: string; docs: DocNode[] }
export interface DocModule { module: string; groups: DocGroup[] }

const V = VOUCHER_RIGHTS, R = REPORT_RIGHTS, M = MASTER_RIGHTS;

export const DOC_TREE: DocModule[] = [
  { module: "Transactions", groups: [
    { group: "Cash and Bank", docs: [
      { key: "receipt",        label: "Receipt",              rights: V, href: "/accounting/receipts" },
      { key: "payment",        label: "Payment",              rights: V, href: "/accounting/payments" },
      { key: "contra",         label: "Contra",               rights: V, href: "/accounting/contra" },
      { key: "petty_cash",     label: "Petty Cash",           rights: V, href: "/accounting/petty-cash" },
      { key: "pdc",            label: "PDC Register",         rights: V, href: "/accounting/pdc" },
      { key: "bank_rec",       label: "Bank Reconciliation",  rights: V, href: "/accounting/bank" },
    ] },
    { group: "Sales", docs: [
      { key: "sales_quotation", label: "Sales Quotation", rights: V, href: "/accounting/sales/quotations" },
      { key: "sale_order",      label: "Sale Order",      rights: V, href: "/accounting/sales/orders" },
      { key: "sales_invoice",   label: "Sales Invoice",   rights: V, href: "/accounting/sales/invoices" },
      { key: "delivery_note",   label: "Delivery Note",   rights: V, href: "/accounting/sales/delivery-notes" },
      { key: "sales_return",    label: "Sales Return",    rights: V, href: "/accounting/sales/returns" },
      { key: "car_invoice",     label: "Car Invoice",     rights: V, href: "/car-sales/contracts" },
    ] },
    { group: "Purchases", docs: [
      { key: "purchase_order",   label: "Purchase Order",         rights: V, href: "/accounting/purchases/orders" },
      { key: "mrn",              label: "Material Receipt (MRN)", rights: V, href: "/accounting/purchases/mrn" },
      { key: "purchase_voucher", label: "Purchase Voucher",       rights: V, href: "/accounting/purchases/vouchers" },
      { key: "purchase_return",  label: "Purchase Return",        rights: V, href: "/accounting/purchases/returns" },
      { key: "supplier_bill",    label: "Supplier Bills",         rights: V, href: "/purchase/bills" },
    ] },
    { group: "Journals", docs: [
      { key: "journal",      label: "Journal Entry",      rights: V, href: "/accounting/journal/new" },
      { key: "invoice_bill", label: "Invoice / Bill",     rights: V, href: "/accounting/invoices" },
      { key: "recurring",    label: "Recurring Vouchers", rights: V, href: "/accounting/recurring" },
    ] },
    { group: "Module Invoicing", docs: [
      { key: "visa_invoice",      label: "Visa Invoices",      rights: V, href: "/accounting/visa-invoices" },
      { key: "transport_invoice", label: "Transport Invoices", rights: V, href: "/accounting/transport-invoices" },
      { key: "hotel_invoice",     label: "Hotel Invoices",     rights: V, href: "/accounting/hotel-invoices" },
    ] },
  ] },

  { module: "Financial Accounting", groups: [
    { group: "Authorisation", docs: [
      { key: "approvals",    label: "Approval Inbox",        rights: ["access", "print"], href: "/accounting/approvals" },
      { key: "auth_rules",   label: "Voucher Authorisation", rights: M, href: "/accounting/rules" },
    ] },
    { group: "Reports", docs: [
      { key: "ledger",         label: "Ledger / Statement", rights: R, href: "/accounting/ledger" },
      { key: "voucher_register", label: "Voucher Register", rights: R, href: "/accounting/journal" },
      { key: "trial_balance",  label: "Trial Balance",      rights: R, href: "/accounting/trial-balance" },
      { key: "profit_loss",    label: "Profit & Loss",      rights: R, href: "/accounting/profit-loss" },
      { key: "balance_sheet",  label: "Balance Sheet",      rights: R, href: "/accounting/balance-sheet" },
      { key: "aging",          label: "Aging (AR/AP)",      rights: R, href: "/accounting/aging" },
      { key: "vat",            label: "VAT Return",         rights: R, href: "/accounting/vat" },
      { key: "sales_costing",  label: "Sales Costing",      rights: R, href: "/accounting/sales-costing" },
      { key: "targets",        label: "Targets & Budget",   rights: R, href: "/accounting/targets" },
      { key: "audit",          label: "Audit Trail",        rights: R, href: "/accounting/audit" },
    ] },
    { group: "Period", docs: [
      { key: "fixed_assets", label: "Fixed Assets",   rights: M, href: "/accounting/assets" },
      { key: "year_close",   label: "Year-End Close", rights: ["access"], href: "/accounting/close" },
    ] },
  ] },

  { module: "Inventory", groups: [
    { group: "Documents", docs: [
      { key: "stock_documents", label: "Document Processing", rights: V, href: "/stock/documents" },
      { key: "stock_indents",   label: "Indents",             rights: V, href: "/stock/indents" },
      { key: "warehouses",      label: "Warehouses",          rights: M, href: "/stock/warehouses" },
    ] },
    { group: "Reports", docs: [
      { key: "stock_query",      label: "Query",                  rights: R, href: "/stock/query" },
      { key: "stock_ledger",     label: "Stock Ledger",           rights: R, href: "/stock/ledger" },
      { key: "stock_opening",    label: "Opening Stocks Register", rights: R, href: "/stock/opening" },
      { key: "stock_statement",  label: "Stock Statement",        rights: R, href: "/stock/statement" },
      { key: "stock_movement",   label: "Stock Movement",         rights: R, href: "/stock/movement", hrefs: ["/stock/multilevel"] },
      { key: "stock_valuation",  label: "Stock Valuation",        rights: R, href: "/stock/valuation" },
      { key: "stock_analysis",   label: "ABC / Ageing / Reorder",  rights: R, href: "/stock/abc", hrefs: ["/stock/ageing", "/stock/reorder", "/stock/virtual", "/stock/peak-low"] },
      { key: "stock_moving",     label: "Fast & Slow Moving",     rights: R, href: "/stock/fast-moving", hrefs: ["/stock/slow-moving"] },
    ] },
  ] },

  { module: "Payroll and HR", groups: [
    { group: "Payroll", docs: [
      { key: "employees", label: "Employees", rights: M, href: "/hr/employees" },
      { key: "payroll",   label: "Payroll",   rights: V, href: "/hr/payroll" },
    ] },
  ] },

  { module: "Masters", groups: [
    { group: "Masters", docs: [
      { key: "coa",          label: "Chart of Accounts",  rights: M, href: "/accounting/accounts" },
      { key: "product_tree", label: "Product Tree",       rights: M, href: "/accounting/masters/products" },
      { key: "cost_centers", label: "Cost Center",        rights: M, href: "/accounting/masters/cost-centers" },
      { key: "tag_areas",    label: "Tag Area",           rights: M, href: "/accounting/masters/tag-areas" },
      { key: "car_expenses", label: "Car Purchase Expense", rights: M, href: "/accounting/masters/car-expenses" },
      { key: "currencies",   label: "Currencies",         rights: M, href: "/accounting/masters/currencies" },
      { key: "salespersons", label: "Salespersons",       rights: M, href: "/accounting/masters/salespersons" },
    ] },
  ] },
];

export const ALL_DOC_KEYS = DOC_TREE.flatMap((m) => m.groups.flatMap((g) => g.docs.map((d) => d.key)));

// The screen a route belongs to, so a page or the middleware can ask for its
// rights by path.
export const DOC_BY_HREF: Record<string, string> = Object.fromEntries(
  DOC_TREE.flatMap((m) => m.groups.flatMap((g) =>
    g.docs.flatMap((d) => [...(d.href ? [d.href] : []), ...(d.hrefs ?? [])].map((h) => [h, d.key] as const))))
);

// Longest matching route prefix, so /accounting/receipts/<id> is still the
// Receipt screen. Routes not in the tree are not rights-gated.
export function docForPath(path: string): string | null {
  let best: string | null = null, bestLen = -1;
  for (const [href, key] of Object.entries(DOC_BY_HREF)) {
    if ((path === href || path.startsWith(href + "/")) && href.length > bestLen) { best = key; bestLen = href.length; }
  }
  return best;
}

export type DocRightsMap = Record<string, Record<string, boolean>>;

// Same convention as staffCan: an empty map is unrestricted, anything ticked
// switches the user to "only what is ticked".
export function hasDocRight(rights: DocRightsMap, isAdmin: boolean, doc: string, right: DocRight): boolean {
  if (isAdmin) return true;
  // No screen key = not a rights-managed screen (a report the Access tab does
  // not name, a master shared by a component that has no entry). Allowed, the
  // same way the database's staff_doc_key returns null for a module posting.
  if (!doc) return true;
  if (!rights || Object.keys(rights).length === 0) return true;
  return !!rights[doc]?.[right];
}
