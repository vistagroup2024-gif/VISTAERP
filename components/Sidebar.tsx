"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "▣" },
  { href: "/bookings", label: "Bookings", icon: "🧾" },
  { href: "/packages", label: "Packages", icon: "📦" },
  { href: "/hotels", label: "Hotels", icon: "🏨" },
  { href: "/allotments", label: "Allotments", icon: "🛏" },
  { href: "/invoices", label: "Invoices", icon: "💳" },
  { href: "/parties", label: "Customers / Agents", icon: "👥" },
];

const ACCOUNTING = [
  { href: "/accounting/accounts", label: "Chart of Accounts", icon: "📚" },
  { href: "/accounting/journal", label: "Journal", icon: "📓" },
  { href: "/accounting/receipts", label: "Receipts", icon: "💵" },
  { href: "/accounting/trial-balance", label: "Trial Balance", icon: "⚖️" },
];

export default function Sidebar({ name }: { name: string }) {
  const path = usePathname();
  const router = useRouter();
  const supabase = createClient();

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="flex w-60 flex-col border-r border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-5 py-4">
        <p className="text-lg font-bold text-brand-dark">Vista ERP</p>
        <p className="truncate text-xs text-slate-400">{name}</p>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {NAV.map((n) => {
          const active = path === n.href || path.startsWith(n.href + "/");
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium ${
                active
                  ? "bg-brand text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <span>{n.icon}</span>
              {n.label}
            </Link>
          );
        })}

        <p className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Accounting
        </p>
        {ACCOUNTING.map((n) => {
          const active = path === n.href || path.startsWith(n.href + "/");
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium ${
                active ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <span>{n.icon}</span>
              {n.label}
            </Link>
          );
        })}
      </nav>
      <button
        onClick={signOut}
        className="m-3 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
      >
        Sign out
      </button>
    </aside>
  );
}
