"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";
import NotificationBell from "@/components/NotificationBell";

// `perm` (any-of) on an Item gates that link individually. Omit to always show.
interface Item { href: string; label: string; icon?: string; perm?: string[]; exact?: boolean }
// `perm` (any-of) gates the whole module. Omit to always show.
interface Group { label: string; icon: string; items: Item[]; perm?: string[] }

export interface StaffNavAccess { unrestricted: boolean; permissions: Record<string, boolean> }

// Standalone top link (no parent).
const DASHBOARD: Item = { href: "/dashboard", label: "Dashboard", icon: "▣" };

// Hierarchical navigation. Each module is a collapsible parent menu.
const GROUPS: Group[] = [
  { label: "Visa", icon: "🕋", perm: ["visa.view", "visa.package_update", "visa.invoices"], items: [
    { href: "/groups", label: "Visa Groups", perm: ["visa.view"] },
    { href: "/visa/invoices", label: "Visa Invoices", perm: ["visa.invoices"] },
    { href: "/groups/package-updates", label: "Package Updates", perm: ["visa.package_update"] },
  ] },
  { label: "BRN Inventory", icon: "📦", perm: ["brn.view", "brn.planning"], items: [
    { href: "/inventory", label: "BRN Dashboard", perm: ["brn.view"] },
    { href: "/inventory/brn", label: "BRN List", perm: ["brn.view"] },
    { href: "/inventory/archived", label: "Archived BRNs", perm: ["brn.view"] },
    { href: "/inventory/calendar", label: "Daily Calendar", perm: ["brn.view"] },
    { href: "/inventory/consume", label: "Consume Inventory", perm: ["brn.add", "brn.edit"] },
    { href: "/inventory/planning", label: "Purchase Planning", perm: ["brn.planning"] },
    { href: "/inventory/history", label: "History", perm: ["brn.view"] },
  ] },
  { label: "Sales", icon: "🧾", perm: ["sales.view"], items: [
    { href: "/bookings", label: "Sales Orders" },
    { href: "/sales/catalog", label: "Service Catalog" },
    { href: "/sales/visas", label: "Visa Tracking" },
    { href: "/packages", label: "Packages" },
    { href: "/invoices", label: "Invoices" },
    { href: "/parties", label: "Customers / Agents" },
  ] },
  { label: "Hotels", icon: "🏨", perm: ["hotels.masters", "hotels.bookings", "hotels.suppliers", "hotels.reports"], items: [
    { href: "/hotels/dashboard", label: "Dashboard", perm: ["hotels.reports"] },
    { href: "/hotels/bookings", label: "Hotel Bookings", perm: ["hotels.bookings"] },
    { href: "/hotels/nusuk", label: "Nusuk Agreements", perm: ["hotels.bookings"] },
    { href: "/hotels/checkin", label: "Check-in / Arrivals", perm: ["hotels.bookings"] },
    { href: "/hotels/checkout", label: "Check-out / Completed", perm: ["hotels.bookings"] },
    { href: "/hotels/suppliers", label: "Suppliers", perm: ["hotels.suppliers"] },
    { href: "/hotels", label: "Hotel Master", perm: ["hotels.masters"], exact: true },
    { href: "/hotels/reports", label: "Reports", perm: ["hotels.reports"] },
  ] },
  { label: "Transport", icon: "🚐", perm: ["transport.masters", "transport.bookings", "transport.operations", "transport.vehicles", "transport.reports", "transport.trip_ledger"], items: [
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
  { label: "Car Sales", icon: "🚗", perm: ["carsales.view"], items: [
    { href: "/car-sales", label: "Dashboard", perm: ["carsales.view", "carsales.reports"] },
    { href: "/car-sales/alerts", label: "Alerts", perm: ["carsales.view", "carsales.reports"] },
    { href: "/car-sales/vehicles", label: "Vehicles / Stock", perm: ["carsales.vehicles", "carsales.view"] },
    { href: "/car-sales/purchases", label: "Purchase Orders", perm: ["carsales.purchase"] },
    { href: "/car-sales/contracts", label: "Installment Contracts", perm: ["carsales.installments", "carsales.sales"] },
    { href: "/car-sales/receipts", label: "Receipts", perm: ["carsales.receipts"] },
    { href: "/car-sales/service-charges", label: "Monthly Charges", perm: ["carsales.charges"] },
    { href: "/car-sales/commissions", label: "Commissions", perm: ["carsales.ownership", "carsales.sales"] },
    { href: "/car-sales/accounting", label: "Accounting", perm: ["carsales.accounting"] },
    { href: "/car-sales/reports", label: "Reports", perm: ["carsales.reports"] },
  ] },
  { label: "Purchase", icon: "🛒", perm: ["purchase.view"], items: [
    { href: "/purchase/bills", label: "Supplier Bills" },
    { href: "/purchase/payments", label: "Supplier Payments" },
  ] },
  { label: "Accounting", icon: "📚", perm: ["accounting.view"], items: [
    { href: "/accounting/accounts", label: "Chart of Accounts" },
    { href: "/accounting/receipts", label: "Receipt" },
    { href: "/accounting/payments", label: "Payment" },
    { href: "/accounting/contra", label: "Contra" },
    { href: "/accounting/journal/new", label: "Journal Entry" },
    { href: "/accounting/invoices", label: "Invoice / Bill" },
    { href: "/accounting/settle", label: "Receive / Pay" },
    { href: "/accounting/pdc", label: "PDC Register" },
    { href: "/accounting/approvals", label: "Approval Inbox" },
    { href: "/accounting/aging", label: "Aging (AR/AP)" },
    { href: "/accounting/ledger", label: "Ledger / Statement" },
    { href: "/accounting/journal", label: "Voucher Register" },
    { href: "/accounting/trial-balance", label: "Trial Balance" },
    { href: "/accounting/profit-loss", label: "Profit & Loss" },
    { href: "/accounting/balance-sheet", label: "Balance Sheet" },
    { href: "/accounting/rules", label: "Approval Rules" },
    { href: "/accounting/audit", label: "Audit Trail" },
  ] },
  { label: "Users", icon: "👤", perm: ["users.view", "users.manage_roles"], items: [
    { href: "/settings/users", label: "Staff Users" },
    { href: "/settings/agents", label: "B2B Agents" },
    { href: "/settings/roles", label: "Roles & Permissions" },
  ] },
  { label: "Settings", icon: "⚙️", perm: ["system.companies", "system.config", "system.masters"], items: [
    { href: "/settings/companies", label: "Companies" },
  ] },
];

function isActive(path: string, href: string, exact?: boolean) {
  if (exact) return path === href;
  return path === href || path.startsWith(href + "/");
}

function NavLink({ href, label, icon, exact, onClick }: Item & { onClick?: () => void }) {
  const path = usePathname();
  const active = isActive(path, href, exact);
  return (
    <Link href={href} onClick={onClick}
      className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium ${
        active ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100"
      }`}>
      {icon && <span>{icon}</span>}
      {label}
    </Link>
  );
}

function CollapsibleGroup({ group, onClose }: { group: Group; onClose?: () => void }) {
  const path = usePathname();
  // A child on the current route decides both the initial expand and the parent
  // highlight. `hasActive` is deterministic on server + client (usePathname),
  // so there is no hydration mismatch; sessionStorage is applied after mount.
  const hasActive = group.items.some((i) => isActive(path, i.href, i.exact));
  const [open, setOpen] = useState(hasActive);

  useEffect(() => {
    const stored = sessionStorage.getItem("nav:" + group.label);
    if (stored !== null) setOpen(stored === "1");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-expand when navigating into this group.
  useEffect(() => { if (hasActive) setOpen(true); }, [hasActive]);

  function toggle() {
    setOpen((o) => {
      const n = !o;
      try { sessionStorage.setItem("nav:" + group.label, n ? "1" : "0"); } catch {}
      return n;
    });
  }

  return (
    <div>
      <button onClick={toggle}
        className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold ${
          hasActive ? "text-brand-dark" : "text-slate-700 hover:bg-slate-100"
        }`}>
        <span>{group.icon}</span>
        <span className="flex-1 text-left">{group.label}</span>
        <span className={`text-xs text-slate-400 transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
      </button>
      {open && (
        <div className="ml-3 mt-0.5 space-y-0.5 border-l border-slate-200 pl-2">
          {group.items.map((i) => <NavLink key={i.href} {...i} onClick={onClose} />)}
        </div>
      )}
    </div>
  );
}

function visibleGroups(access?: StaffNavAccess) {
  if (!access || access.unrestricted) return GROUPS;
  return GROUPS
    // Hide links the user has no permission for, then drop now-empty groups.
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.perm || i.perm.some((k) => access.permissions[k])) }))
    .filter((g) => (!g.perm || g.perm.some((k) => access.permissions[k])) && g.items.length > 0);
}

function SidebarContent({ name, access, onClose, onCollapse }: { name: string; access?: StaffNavAccess; onClose?: () => void; onCollapse?: () => void }) {
  const router = useRouter();
  const supabase = createClient();

  async function signOut() {
    // Local scope: end only THIS device's session, leaving the user's other
    // devices signed in. (Default scope is "global" and revokes every session.)
    await supabase.auth.signOut({ scope: "local" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <Image src="/icon.svg" alt="Vista Group" width={36} height={36} />
          <div>
            <p className="text-sm font-bold text-slate-800 leading-tight">Vista Group</p>
            <p className="truncate text-xs text-slate-400 leading-tight">{name}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <NotificationBell endpoint="/api/notifications" groupBase="/groups" realtime />
          {onCollapse && (
            <button onClick={onCollapse} title="Collapse sidebar" aria-label="Collapse sidebar"
              className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 text-lg leading-none">⇤</button>
          )}
          {onClose && (
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
          )}
        </div>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {(!access || access.unrestricted || access.permissions["dashboard.view"]) && (
          <NavLink {...DASHBOARD} onClick={onClose} />
        )}
        {visibleGroups(access).map((g) => <CollapsibleGroup key={g.label} group={g} onClose={onClose} />)}
      </nav>
      <button onClick={signOut}
        className="m-3 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
        Sign out
      </button>
    </div>
  );
}

export default function Sidebar({ name, access }: { name: string; access?: StaffNavAccess }) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try { setCollapsed(localStorage.getItem("sidebar:collapsed") === "1"); } catch {}
  }, []);
  function toggleCollapsed() {
    setCollapsed((c) => { const n = !c; try { localStorage.setItem("sidebar:collapsed", n ? "1" : "0"); } catch {} return n; });
  }

  return (
    <>
      {/* Desktop sidebar — sticky full-height so its nav scrolls independently */}
      {collapsed ? (
        <div className="no-print sticky top-0 hidden h-screen w-12 shrink-0 flex-col items-center border-r border-slate-200 bg-white py-3 lg:flex">
          <button onClick={toggleCollapsed} title="Expand sidebar" aria-label="Expand sidebar"
            className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 text-lg leading-none">⇥</button>
        </div>
      ) : (
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
          <SidebarContent name={name} access={access} onCollapse={toggleCollapsed} />
        </aside>
      )}

      {/* Mobile top bar */}
      <div className="no-print fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 lg:hidden">
        <div className="flex items-center gap-2">
          <Image src="/icon.svg" alt="Vista Group" width={30} height={30} />
          <p className="text-base font-bold text-slate-800">Vista Group</p>
        </div>
        <div className="flex items-center gap-1">
          <NotificationBell endpoint="/api/notifications" groupBase="/groups" realtime />
          <button onClick={() => setOpen(true)} className="rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label="Open menu">
            <span className="block h-0.5 w-5 bg-current mb-1"></span>
            <span className="block h-0.5 w-5 bg-current mb-1"></span>
            <span className="block h-0.5 w-5 bg-current"></span>
          </button>
        </div>
      </div>

      {/* Mobile drawer overlay */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-72 bg-white shadow-xl">
            <SidebarContent name={name} access={access} onClose={() => setOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}
