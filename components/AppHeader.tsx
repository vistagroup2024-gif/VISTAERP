"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import Icon from "@/components/ui/Icon";
import { searchIndex, type StaffNavAccess } from "@/lib/nav";

// Slim desktop utility bar: working global navigation search + user menu.
// Notifications stay in the sidebar header (not duplicated here). Hidden on
// mobile, which has its own top bar from the Sidebar.
export default function AppHeader({ name, access }: { name: string; access?: StaffNavAccess }) {
  const router = useRouter();
  const supabase = createClient();
  const index = useMemo(() => searchIndex(access), [access]);

  const [q, setQ] = useState("");
  const [openList, setOpenList] = useState(false);
  const [active, setActive] = useState(0);
  const [menu, setMenu] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return index
      .filter((r) => r.label.toLowerCase().includes(s) || r.group.toLowerCase().includes(s))
      .slice(0, 8);
  }, [q, index]);

  // "/" or Cmd/Ctrl-K focuses search from anywhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if ((e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) {
        e.preventDefault(); searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close popovers on outside click.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) { setOpenList(false); setMenu(false); }
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, []);

  function go(href: string) { setQ(""); setOpenList(false); router.push(href); }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!results.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % results.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + results.length) % results.length); }
    else if (e.key === "Enter") { e.preventDefault(); go(results[active].href); }
    else if (e.key === "Escape") { setOpenList(false); }
  }

  async function signOut() {
    await supabase.auth.signOut({ scope: "local" });
    router.push("/login"); router.refresh();
  }

  const initials = (name || "U").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  return (
    <header className="app-header no-print sticky top-0 z-20 hidden h-14 items-center gap-4 border-b border-slate-200 bg-white/95 px-6 backdrop-blur lg:flex">
      {/* Global search */}
      <div ref={wrapRef} className="relative w-full max-w-md">
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
            <Icon name="search" size={16} />
          </span>
          <input
            ref={searchRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setOpenList(true); setActive(0); }}
            onFocus={() => q && setOpenList(true)}
            onKeyDown={onKeyDown}
            placeholder="Search modules…  ( / )"
            className="w-full rounded-md border border-slate-300 bg-slate-50 py-1.5 pl-9 pr-3 text-sm text-slate-700 transition-colors placeholder:text-slate-400 focus:border-brand focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
        </div>
        {openList && results.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-1.5 overflow-hidden rounded-md border border-slate-200 bg-white shadow-pop">
            {results.map((r, i) => (
              <button
                key={r.href}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(r.href)}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm ${i === active ? "bg-brand-50" : "hover:bg-slate-50"}`}
              >
                <Icon name={r.icon} size={16} className="shrink-0 text-slate-400" />
                <span className="font-medium text-slate-700">{r.label}</span>
                <span className="ml-auto text-xs text-slate-400">{r.group}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* User menu */}
        <div className="relative">
          <button onClick={() => setMenu((m) => !m)}
            className="flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-slate-100">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">{initials}</span>
            <span className="max-w-[10rem] truncate text-sm font-medium text-slate-700">{name}</span>
            <Icon name="chevronDown" size={14} className="text-slate-400" />
          </button>
          {menu && (
            <div className="absolute right-0 top-full mt-1.5 w-52 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-pop">
              <div className="border-b border-slate-100 px-3 py-2">
                <p className="truncate text-sm font-semibold text-slate-800">{name}</p>
                <p className="text-xs text-slate-400">Signed in</p>
              </div>
              <Link href="/settings/notifications" onClick={() => setMenu(false)}
                className="flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
                <Icon name="bell" size={16} className="text-slate-400" /> Notifications
              </Link>
              <button onClick={signOut}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-danger hover:bg-danger-soft/40">
                <Icon name="logout" size={16} /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
