"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { dateStr, fmtTime12 } from "@/lib/format";

// The trip nobody pressed Start or Complete on.
//
// A trip's status only moves when a person presses Start, Picked Up and
// Complete, so a forgotten press leaves a trip open for days and nothing said
// so. transport_trip_alerts() (migration 375) lists the two cases — a pickup
// not recorded 3 hours after the scheduled pickup, and a started trip still
// open 1 hour after pickup + driving time — and this draws that list. It is an
// alert, not a notification: it is on the screen for as long as the trip is
// wrong and gone the moment the right button is pressed.
//
// Three places show it, all from this one source: the header pill
// (TripAlertBadge), the dashboard, and the operations board. Only the users
// who run operations see it — TRIP_ALERT_PERMS — because they are the ones
// who can fix it.

// Who sees it is decided in lib/tripAlerts.ts (a plain module — the dashboard
// page is a server component and cannot read a constant from a client file).

export interface TripAlert {
  trip_id: string; booking_id: string; booking_no: string | null; passenger_name: string | null; route: string | null;
  trip_date: string; trip_time: string | null; status: string; kind: "not_picked_up" | "not_completed";
  due_at: string; overdue_min: number; driver_name: string | null; driver_mobile: string | null; agent_name: string | null;
  payment_method: string | null; collect_amount: number | null; sell_rate: number | null;
}

export function overdueText(min: number): string {
  const m = Math.max(0, Math.floor(min));
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d >= 1) return `${d}d ${h % 24}h`;
  if (h >= 1) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

/**
 * Keeps `rpc` fresh: loads on mount, again when transport_trips changes
 * (realtime), on a timer while the page is visible, and the moment a hidden
 * page is looked at again. A hidden page is never refreshed — nobody can read
 * it, and the refresh would only queue the database up for those who can.
 */
export function useTripAlertRpc<T>(rpc: string, pollMs = 60000): { data: T | null; reload: () => Promise<void> } {
  const [data, setData] = useState<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The browser's Supabase client is a singleton and channel(topic) hands back
  // an EXISTING channel of that name — so two mounts sharing a topic (the pill
  // is in the sidebar and the phone bar at once) made the second subscribe an
  // already-subscribed channel, which throws and took the whole page down.
  // One topic per mount, exactly as RealtimeRefresh does.
  const uid = useId();

  const reload = useCallback(async () => {
    const sb = createClient();
    const { data: d, error } = await sb.rpc(rpc);
    if (!error) setData((d as T) ?? null);
  }, [rpc]);

  useEffect(() => {
    const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
    const soon = (ms: number) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { if (!hidden()) reload(); }, ms);
    };
    reload();
    const sb = createClient();
    // Realtime is a convenience on top of the poll; if it fails for any reason
    // the alert must still draw, so nothing here is allowed to throw.
    let ch: ReturnType<typeof sb.channel> | null = null;
    try {
      ch = sb.channel(`rt-trip-alerts-${uid}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "transport_trips" }, () => soon(500))
        .subscribe();
    } catch { ch = null; }
    const iv = setInterval(() => { if (!hidden()) reload(); }, pollMs);
    const onVis = () => { if (!hidden()) reload(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
      if (ch) { try { sb.removeChannel(ch); } catch { /* already gone */ } }
    };
  }, [rpc, pollMs, reload, uid]);

  return { data, reload };
}

const KIND: Record<TripAlert["kind"], { label: string; chip: string; why: string }> = {
  not_picked_up: { label: "Pickup not recorded", chip: "bg-red-100 text-red-700", why: "3 hours past the scheduled pickup and nobody pressed Picked Up" },
  not_completed: { label: "Not completed", chip: "bg-amber-100 text-amber-800", why: "1 hour past pickup + driving time and nobody pressed Complete" },
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending Assignment", assigned: "Assigned", on_route: "Driver En Route", picked_up: "Picked Up",
  outsourced: "Outsourced", outsource_required: "Outsource Required",
};

export default function TripAlerts({ canAct, limit = 8 }: { canAct: boolean; limit?: number }) {
  const router = useRouter();
  const { data, reload } = useTripAlertRpc<TripAlert[]>("transport_trip_alerts");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  const rows = data ?? [];
  if (rows.length === 0) return null;

  const nPick = rows.filter((r) => r.kind === "not_picked_up").length;
  const nDone = rows.length - nPick;
  const shown = all ? rows : rows.slice(0, limit);

  async function setStatus(r: TripAlert, fn: string, args: Record<string, unknown>, confirmText: string) {
    if (!confirm(confirmText)) return;
    setBusy(r.trip_id); setErr(null);
    const sb = createClient();
    const { error } = await sb.rpc(fn, args);
    setBusy(null);
    if (error) { setErr(error.message); return; }
    await reload();
    router.refresh();
  }

  // The same rule the operations board uses: only a Cash booking collects cash
  // on completion; unset (legacy) means a direct booking or the walk-in customer.
  const isCashCustomer = (r: TripAlert) => r.payment_method ? r.payment_method === "cash"
    : (!r.agent_name || r.agent_name.trim().toUpperCase() === "CASH CUSTOMER");

  function complete(r: TripAlert) {
    const who = `${r.passenger_name ?? "Trip"} — ${r.route ?? ""} (${r.booking_no ?? ""})`;
    let cash: number | null = null;
    if (isCashCustomer(r)) {
      const expect = r.collect_amount ?? r.sell_rate;
      const v = window.prompt(`Mark as Completed.\n\n${who}\n\nCash received from the passenger (SAR)? Leave blank if none — it can be edited on the operations board later.`, expect != null ? String(expect) : "");
      if (v === null) return;
      cash = v.trim() === "" ? null : (parseFloat(v) || null);
      setBusy(r.trip_id); setErr(null);
      createClient().rpc("transport_complete_trip", { p_trip: r.trip_id, p_cash: cash }).then(async ({ error }) => {
        setBusy(null);
        if (error) { setErr(error.message); return; }
        await reload(); router.refresh();
      });
      return;
    }
    setStatus(r, "transport_complete_trip", { p_trip: r.trip_id, p_cash: null }, `Mark this trip as Completed?\n\n${who}`);
  }
  function pickedUp(r: TripAlert) {
    setStatus(r, "transport_set_trip_status", { p_trip: r.trip_id, p_status: "picked_up" },
      `Mark the passenger as Picked Up?\n\n${r.passenger_name ?? "Trip"} — ${r.route ?? ""} (${r.booking_no ?? ""})`);
  }

  return (
    <section id="trip-alerts" className="rounded-lg border border-red-300 bg-red-50 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-sm font-bold text-red-800">⚠ {rows.length} trip alert{rows.length === 1 ? "" : "s"}</span>
        {nPick > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">{nPick} pickup not recorded</span>}
        {nDone > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">{nDone} not completed</span>}
        <span className="text-xs text-red-700/80">
          A pickup not recorded 3 hours after its scheduled time, or a started trip still open 1 hour after pickup + driving time.
          Press the status it should be in, or open that day&rsquo;s board.
        </span>
      </div>
      {err && <p className="mt-2 rounded border border-red-300 bg-white px-2 py-1 text-xs text-red-700">{err}</p>}
      <ul className="mt-2 divide-y divide-red-100 rounded-md border border-red-200 bg-white">
        {shown.map((r) => {
          const k = KIND[r.kind];
          const hasDriver = !["pending", "outsource_required"].includes(r.status);
          const dayHref = `/transport/operations?date=${r.trip_date}`;
          return (
            <li key={r.trip_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${k.chip}`} title={k.why}>{k.label}</span>
              <span className="font-mono text-xs text-slate-500">{r.booking_no ?? "—"}</span>
              <span className="font-medium text-slate-800">{r.passenger_name ?? "—"}</span>
              <span className="text-slate-600">{r.route ?? "—"}</span>
              <span className="tabular-nums text-slate-500">{dateStr(r.trip_date)}{r.trip_time ? ` ${fmtTime12(r.trip_time)}` : ""}</span>
              <span className="text-slate-500">{r.driver_name ? `🚘 ${r.driver_name}` : "no driver"}</span>
              {r.agent_name && <span className="text-xs text-slate-400">{r.agent_name}</span>}
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{STATUS_LABEL[r.status] ?? r.status}</span>
              <span className="text-xs font-semibold text-red-600" title={`Threshold passed at ${r.due_at}`}>late by {overdueText(r.overdue_min)}</span>
              <span className="ml-auto flex items-center gap-1.5">
                {canAct && hasDriver && r.status !== "picked_up" && (
                  <button disabled={busy === r.trip_id} onClick={() => pickedUp(r)}
                    className="rounded bg-teal-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-50">Picked Up</button>
                )}
                {canAct && hasDriver && (
                  <button disabled={busy === r.trip_id} onClick={() => complete(r)}
                    className="rounded bg-green-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50">Complete</button>
                )}
                <Link href={dayHref} prefetch={false} className="rounded border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                  {hasDriver ? "Open day ↗" : "Assign / cancel ↗"}
                </Link>
              </span>
            </li>
          );
        })}
      </ul>
      {rows.length > limit && (
        <button onClick={() => setAll((a) => !a)} className="mt-2 text-xs font-medium text-red-700 hover:underline">
          {all ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </section>
  );
}
