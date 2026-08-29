"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const FLOW = ["draft", "pending", "confirmed", "assigned", "on_route", "picked_up", "completed"];
const LABEL: Record<string, string> = {
  draft: "Draft", pending: "Pending Confirmation", confirmed: "Confirmed", assigned: "Assigned",
  on_route: "Driver On Route", picked_up: "Passenger Picked Up", completed: "Completed", cancelled: "Cancelled",
};
const COLOR: Record<string, string> = {
  draft: "bg-slate-200 text-slate-600", pending: "bg-amber-100 text-amber-700", confirmed: "bg-blue-100 text-blue-700",
  assigned: "bg-indigo-100 text-indigo-700", on_route: "bg-cyan-100 text-cyan-700", picked_up: "bg-teal-100 text-teal-700",
  completed: "bg-green-100 text-green-700", cancelled: "bg-red-100 text-red-700",
};

export default function BookingStatusBar({ id, status, lockCancel = false }: { id: string; status: string; lockCancel?: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function setStatus(s: string) {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("transport_set_booking_status", { p_id: id, p_status: s });
    setBusy(false);
    if (error) return setErr(error.message);
    router.refresh();
  }

  // Cancel via the dedicated RPC so completed trips are preserved. If the booking
  // has a completed trip it is NOT fully cancelled — only the remaining trips are.
  async function cancelBooking() {
    if (!confirm("Cancel this booking? Completed trips are kept; only the remaining trips will be cancelled.")) return;
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc("transport_cancel_booking", { p_id: id });
    setBusy(false);
    if (error) return setErr(error.message);
    const r: any = data ?? {};
    if (r.partial) {
      alert(`This booking has ${r.completed} completed trip(s), so it was not fully cancelled. ${r.cancelled_trips} remaining trip(s) were cancelled; the booking stays confirmed.`);
    }
    router.refresh();
  }

  const idx = FLOW.indexOf(status);
  const next = idx >= 0 && idx < FLOW.length - 1 ? FLOW[idx + 1] : null;

  return (
    <div className="card flex flex-wrap items-center gap-3">
      <span className="text-sm text-slate-500">Status</span>
      <span className={`rounded-full px-3 py-1 text-sm font-medium ${COLOR[status] ?? "bg-slate-200"}`}>{LABEL[status] ?? status}</span>
      <div className="ml-auto flex flex-wrap gap-2">
        {next && status !== "cancelled" && (
          <button onClick={() => setStatus(next)} disabled={busy} className="btn text-sm">→ {LABEL[next]}</button>
        )}
        {status !== "cancelled" && status !== "completed" && !lockCancel && (
          <button onClick={cancelBooking} disabled={busy} className="btn-outline text-sm text-red-600">Cancel booking</button>
        )}
        {status !== "cancelled" && status !== "completed" && lockCancel && (
          <span className="text-xs text-slate-500">A trip is completed — cancel remaining trips individually in the Trips section below.</span>
        )}
        {status === "cancelled" && (
          <button onClick={() => setStatus("pending")} disabled={busy} className="btn-outline text-sm">Reopen</button>
        )}
      </div>
      {err && <p className="w-full text-sm text-red-600">{err}</p>}
    </div>
  );
}
