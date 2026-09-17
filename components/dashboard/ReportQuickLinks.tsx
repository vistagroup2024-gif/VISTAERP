"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Icon from "@/components/ui/Icon";
import type { ReportCategory } from "@/lib/reportQuickLinks";

// A compact shortcut bar to the ERP's existing detailed report screens,
// sitting above the dashboard's cards. It does not touch the cards at all —
// it is pure navigation, the same dropdown-menu interaction the header's own
// Transactions quick menu already uses (AppHeader.tsx): a category either
// opens a short list of its own report routes, or — for the three modules
// that already have one consolidated reports screen — is a single link
// straight there. Every href comes from lib/reportQuickLinks.ts, which reads
// them back out of the same nav.ts GROUPS the sidebar uses.
export default function ReportQuickLinks({ categories }: { categories: ReportCategory[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, []);

  if (categories.length === 0) return null;

  return (
    <div ref={ref} className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 shadow-sm print:hidden">
      <span className="shrink-0 px-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">Reports</span>
      {categories.map((c) =>
        c.kind === "link" ? (
          <Link key={c.label} href={c.href} prefetch={false}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-brand-700">
            <Icon name={c.icon} size={14} className="text-slate-400" />
            {c.label}
          </Link>
        ) : (
          <div key={c.label} className="relative">
            <button
              onClick={() => setOpen((o) => (o === c.label ? null : c.label))}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium transition-colors ${open === c.label ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100"}`}
            >
              <Icon name={c.icon} size={14} className="text-slate-400" />
              {c.label}
              <Icon name="chevronDown" size={12} className="text-slate-400" />
            </button>
            {open === c.label && (
              <div className="absolute left-0 top-full z-10 mt-1.5 w-64 max-h-80 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-pop">
                {c.items.map((it) => (
                  <Link key={it.href} href={it.href} prefetch={false} onClick={() => setOpen(null)}
                    className="block px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 hover:text-brand-700">
                    {it.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}
