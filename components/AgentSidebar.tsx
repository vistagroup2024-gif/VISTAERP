"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";
import NotificationBell from "@/components/NotificationBell";

export interface AgentNavItem { label: string; href: string; icon?: string }

function NavLink({ href, label, icon, onClick }: AgentNavItem & { onClick?: () => void }) {
  const path = usePathname();
  const active = href === "/agent" ? path === "/agent" : (path === href || path.startsWith(href + "/"));
  return (
    <Link href={href} onClick={onClick}
      className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium ${active ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100"}`}>
      <span>{icon ?? "•"}</span>
      {label}
    </Link>
  );
}

function Content({ agencyName, nav, onClose }: { agencyName: string; nav: AgentNavItem[]; onClose?: () => void }) {
  async function logout() { await fetch("/api/agent/logout", { method: "POST" }); window.location.href = "/login"; }
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <Image src="/icon.svg" alt="Vista Group" width={36} height={36} />
          <div>
            <p className="text-sm font-bold text-slate-800 leading-tight">Vista B2B</p>
            <p className="truncate text-xs text-slate-400 leading-tight">{agencyName}</p>
          </div>
        </div>
        {onClose && <button onClick={onClose} className="text-xl leading-none text-slate-400 hover:text-slate-600">✕</button>}
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {nav.map((n) => <NavLink key={n.href} {...n} onClick={onClose} />)}
      </nav>
      <button onClick={logout} className="m-3 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">Sign out</button>
    </div>
  );
}

// Agent portal sidebar — same layout/interface as the admin, but the nav only
// lists the modules the agent is authorized for (computed in the layout).
export default function AgentSidebar({ agencyName, nav }: { agencyName: string; nav: AgentNavItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white lg:flex lg:flex-col">
        <Content agencyName={agencyName} nav={nav} />
      </aside>

      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 lg:hidden">
        <div className="flex items-center gap-2">
          <Image src="/icon.svg" alt="Vista Group" width={30} height={30} />
          <p className="text-base font-bold text-slate-800">Vista B2B</p>
        </div>
        <div className="flex items-center gap-1">
          <NotificationBell endpoint="/api/agent/notifications" groupBase="/agent/groups" />
          <button onClick={() => setOpen(true)} className="rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label="Open menu">
            <span className="block mb-1 h-0.5 w-5 bg-current"></span>
            <span className="block mb-1 h-0.5 w-5 bg-current"></span>
            <span className="block h-0.5 w-5 bg-current"></span>
          </button>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-72 bg-white shadow-xl">
            <Content agencyName={agencyName} nav={nav} onClose={() => setOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}
