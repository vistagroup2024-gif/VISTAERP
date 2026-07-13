"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useState } from "react";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "▣" },
  { href: "/groups", label: "Visa Groups", icon: "🕋" },
  { href: "/bookings", label: "Sales Orders", icon: "🧾" },
  { href: "/sales/catalog", label: "Service Catalog", icon: "🗂" },
  { href: "/sales/visas", label: "Visa Tracking", icon: "🛂" },
  { href: "/packages", label: "Packages", icon: "📦" },
  { href: "/hotels", label: "Hotels", icon: "🏨" },
  { href: "/allotments", label: "Allotments", icon: "🛏" },
  { href: "/invoices", label: "Invoices", icon: "💳" },
  { href: "/parties", label: "Customers / Agents", icon: "👥" },
];

const INVENTORY = [
  { href: "/inventory", label: "BRN Dashboard", icon: "📊" },
  { href: "/inventory/planning", label: "Purchase Planning", icon: "🛒" },
  { href: "/inventory/brn", label: "BRN List", icon: "📋" },
  { href: "/inventory/calendar", label: "Daily Calendar", icon: "📅" },
  { href: "/inventory/consume", label: "Consume Inventory", icon: "➖" },
  { href: "/inventory/history", label: "History", icon: "🧾" },
];

const PURCHASE = [
  { href: "/purchase/bills", label: "Supplier Bills", icon: "🧾" },
  { href: "/purchase/payments", label: "Supplier Payments", icon: "💸" },
];

const ACCOUNTING = [
  { href: "/accounting/accounts", label: "Chart of Accounts", icon: "📚" },
  { href: "/accounting/journal", label: "Journal", icon: "📓" },
  { href: "/accounting/receipts", label: "Receipts", icon: "💵" },
  { href: "/accounting/trial-balance", label: "Trial Balance", icon: "⚖️" },
  { href: "/accounting/profit-loss", label: "Profit & Loss", icon: "📈" },
  { href: "/accounting/balance-sheet", label: "Balance Sheet", icon: "🧮" },
];

const SETTINGS = [
  { href: "/settings/users", label: "Users & Roles", icon: "👤" },
  { href: "/settings/companies", label: "Companies", icon: "🏢" },
];

function NavLink({ href, label, icon, onClick }: { href: string; label: string; icon: string; onClick?: () => void }) {
  const path = usePathname();
  const active = path === href || path.startsWith(href + "/");
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium ${
        active ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      <span>{icon}</span>
      {label}
    </Link>
  );
}

function SidebarContent({ name, onClose }: { name: string; onClose?: () => void }) {
  const router = useRouter();
  const supabase = createClient();

  async function signOut() {
    await supabase.auth.signOut();
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
        {onClose && (
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">
            ✕
          </button>
        )}
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {NAV.map((n) => <NavLink key={n.href} {...n} onClick={onClose} />)}

        <p className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">Inventory</p>
        {INVENTORY.map((n) => <NavLink key={n.href} {...n} onClick={onClose} />)}

        <p className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">Purchase</p>
        {PURCHASE.map((n) => <NavLink key={n.href} {...n} onClick={onClose} />)}

        <p className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">Accounting</p>
        {ACCOUNTING.map((n) => <NavLink key={n.href} {...n} onClick={onClose} />)}

        <p className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">Settings</p>
        {SETTINGS.map((n) => <NavLink key={n.href} {...n} onClick={onClose} />)}
      </nav>
      <button
        onClick={signOut}
        className="m-3 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
      >
        Sign out
      </button>
    </div>
  );
}

export default function Sidebar({ name }: { name: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white lg:flex lg:flex-col">
        <SidebarContent name={name} />
      </aside>

      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 lg:hidden">
        <div className="flex items-center gap-2">
          <Image src="/icon.svg" alt="Vista Group" width={30} height={30} />
          <p className="text-base font-bold text-slate-800">Vista Group</p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="rounded-md p-2 text-slate-600 hover:bg-slate-100"
          aria-label="Open menu"
        >
          <span className="block h-0.5 w-5 bg-current mb-1"></span>
          <span className="block h-0.5 w-5 bg-current mb-1"></span>
          <span className="block h-0.5 w-5 bg-current"></span>
        </button>
      </div>

      {/* Mobile drawer overlay */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-72 bg-white shadow-xl">
            <SidebarContent name={name} onClose={() => setOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}
