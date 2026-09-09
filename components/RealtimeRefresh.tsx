"use client";

import { useEffect, useId, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Subscribes to Supabase Realtime (Postgres changes over WebSockets) for the
// given tables and refreshes the current route when any of them change, so
// tables / dashboards / KPIs update live without a manual reload.
//
// REFRESHING A PAGE NOBODY IS LOOKING AT. router.refresh() is a full server
// re-render of the route — middleware, the layout's staff_access, and every
// query the page makes. Nothing here used to ask whether the page was on
// screen, so a Transport Operations tab left in the background re-rendered
// itself every twenty seconds for as long as it stayed open: 180 renders an
// hour, each several Supabase calls, to update pixels nobody could see. The
// agent portal did the same at fifteen. That is the load the dashboard queues
// behind when somebody actually opens it.
//
// So a refresh is deferred while the document is hidden and the missed one is
// remembered. The moment the page is looked at again it refreshes, once. What
// the user sees is unchanged — a hidden page has nothing to go stale on, and it
// is up to date before it is visible again — and no accounting, booking or
// transport figure can be read stale, because reading it requires being here.
//
// Both triggers also share one timer now. A realtime burst and a poll landing
// together used to be able to fire two renders; they coalesce into one.
export default function RealtimeRefresh({ tables, pollMs }: { tables: string[]; pollMs?: number }) {
  const router = useRouter();
  const uid = useId();                                   // unique per mount → no channel-topic clash
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const missed = useRef(false);                          // a refresh fell due while hidden

  useEffect(() => {
    const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

    // The one way in, whatever asked for it.
    const refresh = () => {
      if (hidden()) { missed.current = true; return; }
      missed.current = false;
      router.refresh();
    };
    const schedule = (ms: number) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(refresh, ms);
    };

    let supabase: ReturnType<typeof createClient>;
    let ch: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null;
    try {
      supabase = createClient();
      ch = supabase.channel(`rt-${uid}`);
      for (const t of tables) {
        ch.on("postgres_changes", { event: "*", schema: "public", table: t }, () => schedule(400)); // debounce bursts
      }
      ch.subscribe();
    } catch { /* realtime unavailable — page still works, just no live refresh */ }
    // Polling fallback: where RLS-scoped realtime can't reach the client (e.g.
    // the agent portal on a custom session token), poll so the screen still
    // updates without a manual reload.
    const iv = pollMs && pollMs > 0 ? setInterval(refresh, pollMs) : null;

    // Coming back to the tab is itself a reason to refresh, but only if
    // something was actually missed while it was away.
    const onVisibility = () => { if (!hidden() && missed.current) refresh(); };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      try { if (ch) supabase.removeChannel(ch); } catch { /* ignore */ }
      if (timer.current) clearTimeout(timer.current);
      if (iv) clearInterval(iv);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables.join(","), pollMs]);

  return null;
}
