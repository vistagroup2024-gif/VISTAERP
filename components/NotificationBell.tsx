"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { playChime, chimeMuted, setChimeMuted } from "@/lib/notificationChime";
import { dateTimeStr } from "@/lib/format";

interface Notif {
  id: string; category: string; title: string; body: string | null;
  module: string | null; group_id: string | null; link?: string | null; read: boolean; created_at: string;
}

const CAT_ICON: Record<string, string> = {
  visa: "🛂", package: "🔄", brn: "🏨", reservation: "🎯", inventory: "📊", system: "🔔",
};

/* ── One feed per endpoint, however many bells are on screen ────────────────
 *
 * The bell is rendered more than once on purpose. The staff shell draws it in
 * the sidebar header AND in the mobile top bar — CSS shows whichever fits, but
 * React mounts both — and opening the mobile drawer renders the sidebar again,
 * so a phone with the menu open had three. The agent portal has its own pair,
 * in its layout and in AgentSidebar. Each one used to fetch the feed on mount
 * and open its own realtime channel, so the same notifications were fetched two
 * or three times over and the same table was subscribed to as many times.
 *
 * The instances are not the problem — each is in the right place, and removing
 * one would take the bell off either the desktop or the phone. What was wrong is
 * that each owned its own copy of the data. So the data moved out of them: one
 * feed per endpoint, refcounted, holding the items, the one fetch, the one
 * subscription and the "what is new since last time" bookkeeping that decides
 * when the chime sounds.
 *
 * The first bell to mount starts the feed; the last to unmount stops it. Every
 * bell renders the same items and shows the same count, and marking one read
 * updates all of them at once, which it did not do before. Keyed by endpoint so
 * the staff feed and the agent feed stay separate.
 */
type Feed = {
  items: Notif[];
  listeners: Set<() => void>;
  refs: number;
  seen: Set<string>;
  primed: boolean;
  stop: (() => void) | null;
};
const EMPTY: Notif[] = [];
const feeds = new Map<string, Feed>();

function feedFor(endpoint: string): Feed {
  let f = feeds.get(endpoint);
  if (!f) {
    f = { items: EMPTY, listeners: new Set(), refs: 0, seen: new Set(), primed: false, stop: null };
    feeds.set(endpoint, f);
  }
  return f;
}
const emit = (f: Feed) => f.listeners.forEach((l) => l());

async function postTo(endpoint: string, body: any) {
  const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return res.ok ? res.json().catch(() => ({})) : {};
}

async function loadFeed(endpoint: string) {
  const f = feedFor(endpoint);
  const j = await postTo(endpoint, { action: "list" });
  const list: Notif[] = j.notifications ?? [];
  // Fire desktop notifications for genuinely new items (skip the first load).
  const fresh = f.primed ? list.filter((n) => !f.seen.has(n.id)) : [];
  if (fresh.length && typeof window !== "undefined") {
    // One tone for the batch, not one per item: three things arriving at once
    // should sound like an arrival, not an alarm. And once for the batch rather
    // than once per bell on screen, which is what it used to be.
    playChime();
    if ("Notification" in window && Notification.permission === "granted") {
      for (const n of fresh) {
        try { new Notification(n.title, { body: n.body ?? undefined, tag: n.id }); } catch { /* ignore */ }
      }
    }
  }
  f.seen = new Set(list.map((n) => n.id));
  f.primed = true;
  f.items = list;
  emit(f);
}

/** First bell in starts the feed; last one out stops it. */
function acquireFeed(endpoint: string, realtime: boolean) {
  const f = feedFor(endpoint);
  f.refs += 1;
  if (f.refs > 1) return;                       // somebody else already owns it
  loadFeed(endpoint);
  if (realtime) {
    try {
      const supabase = createClient();
      const ch = supabase.channel(`rt-notif-${endpoint}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => loadFeed(endpoint))
        .subscribe();
      f.stop = () => { try { supabase.removeChannel(ch); } catch { /* ignore */ } };
      return;
    } catch { /* realtime unavailable — fall through to polling */ }
  }
  const iv = setInterval(() => loadFeed(endpoint), 30000); // fallback: poll
  f.stop = () => clearInterval(iv);
}

function releaseFeed(endpoint: string) {
  const f = feedFor(endpoint);
  f.refs = Math.max(0, f.refs - 1);
  if (f.refs === 0) { f.stop?.(); f.stop = null; }
}

// Notification bell for both portals. `endpoint` proxies to the feed/mark RPCs;
// `groupBase` is the route prefix for a related group; `realtime` enables live push
// via Supabase Realtime (staff), otherwise it polls. Desktop browser
// notifications fire for newly arrived items once the user grants permission.
export default function NotificationBell({
  endpoint, groupBase, realtime = false,
}: { endpoint: string; groupBase: string; realtime?: boolean }) {
  const router = useRouter();
  // The items are the feed's, not this bell's. Every bell on screen renders the
  // same list and the same count, and one of them marking something read shows
  // on all of them.
  const feed = useMemo(() => feedFor(endpoint), [endpoint]);
  const items = useSyncExternalStore(
    useCallback((cb: () => void) => { feed.listeners.add(cb); return () => { feed.listeners.delete(cb); }; }, [feed]),
    () => feed.items,
    () => EMPTY,                                         // nothing to render on the server
  );
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  // Where to draw the panel. Every bell in the app sits near a screen edge —
  // the sidebar header, the mobile top bar — so anchoring the panel to the
  // button and letting it hang wherever it lands cut it off: at 320px wide,
  // opening leftwards from a bell 180px in put a third of it off-screen.
  // The panel is therefore positioned in viewport coordinates and clamped so
  // it is always fully visible, whichever edge its bell happens to be near.
  const [panel, setPanel] = useState<{ top: number; left: number; maxH: number } | null>(null);
  const [muted, setMuted] = useState(false);
  // Read the mute preference on mount, not during render: it lives in
  // localStorage, which the server does not have.
  useEffect(() => { setMuted(chimeMuted()); }, []);

  // Join the feed. The first bell to do this starts it; the last to leave stops
  // it. A second or third bell costs nothing.
  useEffect(() => {
    acquireFeed(endpoint, realtime);
    return () => releaseFeed(endpoint);
  }, [endpoint, realtime]);

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
    feed.items = op === "dismiss"
      ? feed.items.filter((x) => x.id !== id)
      : feed.items.map((x) => x.id === id ? { ...x, read: true } : x);
    emit(feed);
    await postTo(endpoint, { action: "mark", id, op });
  }
  async function markAll() {
    feed.items = feed.items.map((x) => ({ ...x, read: true }));
    emit(feed);
    await postTo(endpoint, { action: "mark", op: "read_all" });
  }
  function openRecord(n: Notif) {
    mark(n.id, "read");
    setOpen(false);
    // Prefer the exact deep-link; fall back to the group route.
    if (n.link) router.push(n.link);
    else if (n.group_id) router.push(`${groupBase}/${n.group_id}`);
  }

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const b = btnRef.current?.getBoundingClientRect();
      if (!b) return;
      const margin = 8, width = 320;
      const w = Math.min(width, window.innerWidth - margin * 2);
      // Prefer lining the panel's right edge up with the bell, then pull it
      // back inside whichever edge it would have crossed.
      const left = Math.max(margin, Math.min(b.right - w, window.innerWidth - w - margin));
      const top = b.bottom + 8;
      setPanel({ top, left, maxH: Math.max(160, window.innerHeight - top - margin) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);   // a scrolling sidebar moves the bell
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  const unread = items.filter((n) => !n.read).length;

  return (
    <div className="relative" ref={ref}>
      <button ref={btnRef} onClick={openPanel} className="relative rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label="Notifications">
        <span className="text-xl leading-none">🔔</span>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="fixed z-50 flex w-80 max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
             style={panel ? { top: panel.top, left: panel.left, maxHeight: panel.maxH } : { visibility: "hidden" }}>
          <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-2">
            <span className="font-semibold text-slate-700">Notifications</span>
            <div className="flex items-center gap-3">
              {/* Tapping it also plays the tone, which is the only way to find
                  out what it sounds like without waiting for something to happen. */}
              <button
                onClick={() => { const next = !muted; setMuted(next); setChimeMuted(next); if (!next) playChime(); }}
                title={muted ? "Sound is off — turn it on and hear it" : "Sound is on — click to mute"}
                className="text-xs text-slate-500 hover:text-brand">
                {muted ? "🔇 Sound off" : "🔔 Sound on"}
              </button>
              {unread > 0 && <button onClick={markAll} className="text-xs text-brand hover:underline">Mark all read</button>}
            </div>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {items.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-400">No notifications.</li>}
            {items.map((n) => (
              <li key={n.id} className={`border-b border-slate-50 px-4 py-3 text-sm ${n.read ? "" : "bg-brand/5"}`}>
                <div className="flex items-start gap-2">
                  <span>{CAT_ICON[n.category] ?? "🔔"}</span>
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-medium text-slate-800">{n.title}</p>
                    {n.body && <p className="break-words text-xs text-slate-500">{n.body}</p>}
                    <p className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                      {dateTimeStr(n.created_at)}
                      {n.module ? ` · ${n.module}` : ""}
                    </p>
                    <div className="mt-1 flex gap-3 text-xs">
                      {(n.link || n.group_id) && <button onClick={() => openRecord(n)} className="text-brand hover:underline">Open</button>}
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
