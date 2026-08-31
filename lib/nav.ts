import type { IconName } from "@/components/ui/Icon";

// Shared navigation model — the single source of truth for both the Sidebar and
// the global search. Data only (no JSX), so it can be imported anywhere.

// `perm` (any-of) on an Item gates that link individually. Omit to always show.
export interface NavItem { href: string; label: string; icon?: IconName; perm?: string[]; exact?: boolean }
// `perm` (any-of) gates the whole module. Omit to always show.
export interface NavGroup { label: string; icon: IconName; items: NavItem[]; perm?: string[] }

export interface StaffNavAccess { unrestricted: boolean; permissions: Record<string, boolean> }

export const DASHBOARD: NavItem = { href: "/dashboard", label: "Dashboard", icon: "dashboard" };

export const GROUPS: NavGroup[] = [
  { label: "Visa", icon: "visa", perm: ["visa.view", "visa.package_update", "visa.invoices"], items: [
    { href: "/groups", label: "Visa Groups", perm: ["visa.view"] },
    { href: "/visa/invoices", label: "Visa Invoices", perm: ["visa.invoices"] },
    { href: "/groups/package-updates", label: "Package Updates", perm: ["visa.package_update"] },
  ] },
  { label: "BRN Inventory", icon: "inventory", perm: ["brn.view", "brn.planning"], items: [
    { href: "/inventory", label: "BRN Dashboard", perm: ["brn.view"] },
    { href: "/inventory/brn", label: "BRN List", perm: ["brn.view"] },
    { href: "/inventory/archived", label: "Archived BRNs", perm: ["brn.view"] },
    { href: "/inventory/calendar", label: "Daily Calendar", perm: ["brn.view"] },
    { href: "/inventory/consume", label: "Consume Inventory", perm: ["brn.add", "brn.edit"] },
    { href: "/inventory/planning", label: "Purchase Planning", perm: ["brn.planning"] },
    { href: "/inventory/history", label: "History", perm: ["brn.view"] },
  ] },
  { label: "Hotels", icon: "hotel", perm: ["hotels.masters", "hotels.bookings", "hotels.suppliers", "hotels.reports"], items: [
    { href: "/hotels/dashboard", label: "Dashboard", perm: ["hotels.reports"] },
    { href: "/hotels/bookings", label: "Hotel Bookings", perm: ["hotels.bookings"] },
    { href: "/hotels/nusuk", label: "Nusuk Agreements", perm: ["hotels.bookings"] },
    { href: "/hotels/checkin", label: "Check-in / Arrivals", perm: ["hotels.bookings"] },
    { href: "/hotels/checkout", label: "Check-out / Completed", perm: ["hotels.bookings"] },
    { href: "/hotels/suppliers", label: "Suppliers", perm: ["hotels.suppliers"] },
    { href: "/hotels", label: "Hotel Master", perm: ["hotels.masters"], exact: true },
    { href: "/hotels/reports", label: "Reports", perm: ["hotels.reports"] },
  ] },
  { label: "Transport", icon: "transport", perm: ["transport.masters", "transport.bookings", "transport.operations", "transport.vehicles", "transport.reports", "transport.trip_ledger"], items: [
    { href: "/transport", label: "Overview", perm: ["transport.masters", "transport.bookings", "transport.operations", "transport.vehicles", "transport.driver_assign"] },
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
  { label: "Car Sales", icon: "car", perm: ["carsales.view"], items: [
    { href: "/car-sales", label: "Dashboard", perm: ["carsales.view", "carsales.reports"] },
    { href: "/car-sales/alerts", label: "Alerts", perm: ["carsales.view", "carsales.reports"] },
    { href: "/car-sales/vehicles", label: "Vehicles / Stock", perm: ["carsales.vehicles", "carsales.view"] },
    { href: "/car-sales/contracts", label: "Car Invoices", perm: ["carsales.installments", "carsales.sales"] },
    { href: "/car-sales/service-charges", label: "Monthly Charges", perm: ["carsales.charges"] },
    { href: "/car-sales/commissions", label: "Commissions", perm: ["carsales.ownership", "carsales.sales"] },
    { href: "/car-sales/reports", label: "Reports", perm: ["carsales.reports"] },
  ] },
  { label: "Sales", icon: "sales", perm: ["sales.view", "parties.manage"], items: [
    { href: "/bookings", label: "Sales Orders", perm: ["sales.view"] },
    { href: "/sales/catalog", label: "Service Catalog", perm: ["sales.view"] },
    { href: "/sales/visas", label: "Visa Tracking", perm: ["sales.view"] },
    { href: "/packages", label: "Packages", perm: ["sales.view"] },
    { href: "/invoices", label: "Invoices", perm: ["sales.view"] },
    { href: "/accounting/sales/quotations", label: "Sales Quotation", perm: ["sales.view"] },
    { href: "/accounting/sales/orders", label: "Sale Order", perm: ["sales.view"] },
    { href: "/accounting/sales/delivery-notes", label: "Delivery Note", perm: ["sales.view"] },
    { href: "/accounting/sales/returns", label: "Sales Return", perm: ["sales.view"] },
  ] },
  { label: "Purchase", icon: "purchase", perm: ["purchase.view"], items: [
    { href: "/purchase/bills", label: "Supplier Bills" },
    { href: "/purchase/payments", label: "Supplier Payments" },
    { href: "/accounting/purchases/orders", label: "Purchase Order" },
    { href: "/accounting/purchases/vouchers", label: "Purchase Voucher" },
    { href: "/accounting/purchases/mrn", label: "Material Receipt (MRN)" },
    { href: "/accounting/purchases/returns", label: "Purchase Return" },
  ] },
  { label: "Masters", icon: "masters", perm: ["accounting.view"], items: [
    { href: "/accounting/accounts", label: "Chart of Accounts" },
    { href: "/accounting/masters/products", label: "Product Tree" },
    { href: "/accounting/masters/tag-areas", label: "Tag Area" },
    { href: "/accounting/masters/cost-centers", label: "Cost Center" },
    { href: "/accounting/masters/car-expenses", label: "Car Purchase Expense" },
    { href: "/accounting/masters/currencies", label: "Currencies" },
    { href: "/accounting/masters/salespersons", label: "Salespersons & Commission" },
  ] },
  { label: "Accounting", icon: "accounting", perm: ["accounting.view"], items: [
    { href: "/accounting", label: "Dashboard" },
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
    { href: "/accounting/rules", label: "Approval Rules" },
    { href: "/accounting/audit", label: "Audit Trail" },
  ] },
  { label: "Store", icon: "store", perm: ["accounting.view"], items: [
    { href: "/store/movement", label: "Stock Movement" },
    { href: "/store/balance", label: "Stock Balance" },
    { href: "/store/warehouses", label: "Warehouses" },
  ] },
  { label: "Payroll / HR", icon: "payroll", perm: ["accounting.view"], items: [
    { href: "/hr/employees", label: "Employees" },
    { href: "/hr/payroll", label: "Payroll" },
  ] },
  { label: "Users", icon: "users", perm: ["users.view", "users.manage_roles"], items: [
    { href: "/settings/users", label: "Staff Users" },
    { href: "/settings/agents", label: "B2B Agents" },
    { href: "/settings/roles", label: "Roles & Permissions" },
  ] },
  { label: "Settings", icon: "settings", perm: ["system.companies", "system.config", "system.masters"], items: [
    { href: "/settings/companies", label: "Companies" },
  ] },
  { label: "Notifications", icon: "bell", perm: ["dashboard.view"], items: [
    { href: "/settings/notifications", label: "Phone Notifications" },
  ] },
];

// Flattened, permission-filtered index for global search.
export function searchIndex(access?: StaffNavAccess): { label: string; href: string; group: string; icon: IconName }[] {
  const out: { label: string; href: string; group: string; icon: IconName }[] = [];
  const allow = (perm?: string[]) => !perm || !access || access.unrestricted || perm.some((k) => access.permissions[k]);
  if (allow(["dashboard.view"])) out.push({ label: "Dashboard", href: "/dashboard", group: "General", icon: "dashboard" });
  for (const g of GROUPS) {
    if (!allow(g.perm)) continue;
    for (const it of g.items) if (allow(it.perm)) out.push({ label: it.label, href: it.href, group: g.label, icon: g.icon });
  }
  return out;
}
