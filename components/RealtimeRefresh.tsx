"use client";

import { useEffect, useId, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Subscribes to Supabase Realtime (Postgres changes over WebSockets) for the
// given tables and refreshes the current route when any of them change, so
// tables / dashboards / KPIs update live without a manual reload.
export default function RealtimeRefresh({ tables }: { tables: string[] }) {
  const router = useRouter();
  const uid = useId();                                   // unique per mount → no channel-topic clash
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let supabase: ReturnType<typeof createClient>;
    let ch: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null;
    try {
      supabase = createClient();
      ch = supabase.channel(`rt-${uid}`);
      for (const t of tables) {
        ch.on("postgres_changes", { event: "*", schema: "public", table: t }, () => {
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => router.refresh(), 400); // debounce bursts
        });
      }
      ch.subscribe();
    } catch { /* realtime unavailable — page still works, just no live refresh */ }
    return () => { try { if (ch) supabase.removeChannel(ch); } catch { /* ignore */ } if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables.join(",")]);

  return null;
}
