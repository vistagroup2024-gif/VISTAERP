"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";
import NotificationBell from "@/components/NotificationBell";

interface Item { href: string; label: string; icon?: string }
// `perm` (any-of) gates the whole module. Omit to always show.
interface Group { label: string; icon: string; items: Item[]; perm?: string[] }

export interface StaffNavAccess { unrestricted: boolean; permissions: Record<string, boolean> }

// Standalone top link (no parent).
const DASHBOARD: Item = { href: "/dashboard", label: "Dashboard", icon: "▣" };

// Hierarchical navigation. Each module is a collapsible parent menu.
const GROUPS: Group[] = [
  { label: "Visa", icon: "🕋", items: [
    { href: "/groups", label: "Visa Groups" },
    { href: "/groups/package-updates", label: "Package Updates" },
    { href: "/inventory", label: "BRN Dashboard" },
    { href: "/inventory/brn", label: "BRN List" },
    { href: "/inventory/archived", label: "Archived BRNs" },
    { href: "/inventory/calendar", label: "Daily Calendar" },
    { href: "/inventory/consume", label: "Consume Inventory" },
    { href: "/inventory/planning", label: "Purchase Planning" },
    { href: "/inventory/history", label: "History" },
  ], perm: ["visa.view", "brn.view", "brn.planning"] },
  { label: "Sales", icon: "🧾", perm: ["sales.view"], items: [
    { href: "/bookings", label: "Sales Orders" },
    { href: "/sales/catalog", label: "Service Catalog" },
    { href: "/sales/visas", label: "Visa Tracking" },
    { href: "/packages", label: "Packages" },
    { href: "/invoices", label: "Invoices" },
    { href: "/parties", label: "Customers / Agents" },
  ] },
  { label: "Hotels", icon: "🏨", perm: ["hotels.masters", "hotels.bookings", "hotels.suppliers"], items: [
    { href: "/hotels", label: "Hotels" },
    { href: "/allotments", label: "Allotments" },
  ] },
  { label: "Transport", icon: "🚐", perm: ["transport.masters", "transport.bookings", "transport.operations", "transport.vehicles", "transport.reports"], items: [
    { href: "/transport", label: "Overview" },
    { href: "/transport/operations", label: "Operations" },
    { href: "/transport/bookings", label: "Bookings" },
    { href: "/transport/vehicles", label: "Vehicles" },
    { href: "/transport/routes", label: "Routes & Rates" },
    { href: "/transport/packages", label: "Packages" },
    { href: "/transport/drivers", label: "Drivers" },
    { href: "/transport/fleet", label: "Fleet Health" },
    { href: "/transport/vendors", label: "Vendors" },
    { href: "/transport/expenses", label: "Expenses" },
    { href: "/transport/messages", label: "Confirmations" },
    { href: "/transport/reports", label: "Reports" },
  ] },
  { label: "Purchase", icon: "🛒", perm: ["purchase.view"], items: [
    { href: "/purchase/bills", label: "Supplier Bills" },
    { href: "/purchase/payments", label: "Supplier Payments" },
  ] },
  { label: "Accounting", icon: "📚", perm: ["accounting.view"], items: [
    { href: "/accounting/accounts", label: "Chart of Accounts" },
    { href: "/accounting/journal", label: "Journal" },
    { href: "/accounting/receipts", label: "Receipts" },
    { href: "/accounting/trial-balance", label: "Trial Balance" },
    { href: "/accounting/profit-loss", label: "Profit & Loss" },
    { href: "/accounting/balance-sheet", label: "Balance Sheet" },
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

function isActive(path: string, href: string) {
  return path === href || path.startsWith(href + "/");
}

function NavLink({ href, label, icon, onClick }: Item & { onClick?: () => void }) {
  const path = usePathname();
  const active = isActive(path, href);
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
  const hasActive = group.items.some((i) => isActive(path, i.href));
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
  return GROUPS.filter((g) => !g.perm || g.perm.some((k) => access.permissions[k]));
}

function SidebarContent({ name, access, onClose }: { name: string; access?: StaffNavAccess; onClose?: () => void }) {
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
          {onClose && (
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
          )}
        </div>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        <NavLink {...DASHBOARD} onClick={onClose} />
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

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white lg:flex lg:flex-col">
        <SidebarContent name={name} access={access} />
      </aside>

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
