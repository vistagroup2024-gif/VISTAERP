"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Notif {
  id: string; category: string; title: string; body: string | null;
  module: string | null; group_id: string | null; read: boolean; created_at: string;
}

const CAT_ICON: Record<string, string> = {
  visa: "🛂", package: "🔄", brn: "🏨", reservation: "🎯", inventory: "📊", system: "🔔",
};

// Notification bell for both portals. `endpoint` proxies to the feed/mark RPCs;
// `groupHref` builds the link to a related group; `realtime` enables live push
// via Supabase Realtime (staff), otherwise it polls. Desktop browser
// notifications fire for newly arrived items once the user grants permission.
export default function NotificationBell({
  endpoint, groupHref, realtime = false,
}: { endpoint: string; groupHref: (id: string) => string; realtime?: boolean }) {
  const router = useRouter();
  const [items, setItems] = useState<Notif[]>([]);
  const [open, setOpen] = useState(false);
  const seen = useRef<Set<string>>(new Set());
  const primed = useRef(false);
  const ref = useRef<HTMLDivElement>(null);

  const post = useCallback(async (body: any) => {
    const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return res.ok ? res.json().catch(() => ({})) : {};
  }, [endpoint]);

  const load = useCallback(async () => {
    const j = await post({ action: "list" });
    const list: Notif[] = j.notifications ?? [];
    // Fire desktop notifications for genuinely new items (skip the first load).
    if (primed.current && typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
      for (const n of list) {
        if (!seen.current.has(n.id)) {
          try { new Notification(n.title, { body: n.body ?? undefined, tag: n.id }); } catch { /* ignore */ }
        }
      }
    }
    seen.current = new Set(list.map((n) => n.id));
    primed.current = true;
    setItems(list);
  }, [post]);

  useEffect(() => {
    load();
    if (realtime) {
      const supabase = createClient();
      const ch = supabase.channel("rt-notifications")
        .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => load())
        .subscribe();
      return () => { supabase.removeChannel(ch); };
    }
    const iv = setInterval(load, 30000); // agent fallback: poll
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realtime]);

  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  async function openPanel() {
    setOpen((o) => !o);
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      try { await Notification.requestPermission(); } catch { /* ignore */ }
    }
  }

  async function mark(id: string, op: "read" | "dismiss") {
    setItems((xs) => op === "dismiss" ? xs.filter((x) => x.id !== id) : xs.map((x) => x.id === id ? { ...x, read: true } : x));
    await post({ action: "mark", id, op });
  }
  async function markAll() {
    setItems((xs) => xs.map((x) => ({ ...x, read: true })));
    await post({ action: "mark", op: "read_all" });
  }
  function openRecord(n: Notif) {
    mark(n.id, "read");
    setOpen(false);
    if (n.group_id) router.push(groupHref(n.group_id));
  }

  const unread = items.filter((n) => !n.read).length;

  return (
    <div className="relative" ref={ref}>
      <button onClick={openPanel} className="relative rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label="Notifications">
        <span className="text-xl leading-none">🔔</span>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
            <span className="font-semibold text-slate-700">Notifications</span>
            {unread > 0 && <button onClick={markAll} className="text-xs text-brand hover:underline">Mark all read</button>}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {items.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-400">No notifications.</li>}
            {items.map((n) => (
              <li key={n.id} className={`border-b border-slate-50 px-4 py-3 text-sm ${n.read ? "" : "bg-brand/5"}`}>
                <div className="flex items-start gap-2">
                  <span>{CAT_ICON[n.category] ?? "🔔"}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-800">{n.title}</p>
                    {n.body && <p className="text-xs text-slate-500">{n.body}</p>}
                    <p className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                      {new Date(n.created_at).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      {n.module ? ` · ${n.module}` : ""}
                    </p>
                    <div className="mt-1 flex gap-3 text-xs">
                      {n.group_id && <button onClick={() => openRecord(n)} className="text-brand hover:underline">Open</button>}
                      {!n.read && <button onClick={() => mark(n.id, "read")} className="text-slate-500 hover:underline">Mark read</button>}
                      <button onClick={() => mark(n.id, "dismiss")} className="text-red-500 hover:underline">Dismiss</button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
