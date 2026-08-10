"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface T {
  id: string; seq: number | null; route_label: string | null; route_name?: string | null;
  trip_date: string | null; trip_time: string | null; sell_rate: number | null; status: string;
}

// Per-trip cancel inside a booking (item 4). Cancelling one leg of a package
// re-prices the rest as a multiple booking server-side (item 8).
export default function BookingTripsCancel({ bookingId, trips, isPackage }: { bookingId: string; trips: T[]; isPackage: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function cancel(id: string) {
    if (!confirm(isPackage
      ? "Cancel this trip? The remaining package trips will be converted to a multiple booking and re-priced at individual rates."
      : "Cancel this trip? The booking total will be recalculated.")) return;
    setBusy(id); setErr(null);
    const { error } = await supabase.rpc("transport_cancel_trip", { p_trip: id });
    setBusy(null);
    if (error) return setErr(error.message);
    router.refresh();
  }

  const active = trips.filter((t) => t.status !== "cancelled");
  if (trips.length <= 1) return null; // single-trip booking: use delete/cancel booking instead

  return (
    <div className="card mt-4">
      <h2 className="font-semibold text-slate-700">Trips</h2>
      <p className="mt-1 text-xs text-slate-500">Cancel an individual trip without cancelling the whole booking.</p>
      {err && <div className="mt-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="px-3 py-2">#</th><th className="px-3 py-2">Trip</th><th className="px-3 py-2">Date / Time</th><th className="px-3 py-2 text-right">Fare</th><th className="px-3 py-2">Status</th><th className="px-3 py-2"></th></tr>
          </thead>
          <tbody>
            {trips.map((t, i) => {
              const cancelled = t.status === "cancelled";
              return (
                <tr key={t.id} className={`border-t border-slate-100 ${cancelled ? "text-slate-400 line-through" : ""}`}>
                  <td className="px-3 py-2">{t.seq ?? i + 1}</td>
                  <td className="px-3 py-2 font-medium">{t.route_label ?? t.route_name ?? "Trip"}</td>
                  <td className="px-3 py-2">{t.trip_date ?? "—"} {t.trip_time?.slice(0, 5) ?? ""}</td>
                  <td className="px-3 py-2 text-right">{Number(t.sell_rate ?? 0).toFixed(2)}</td>
                  <td className="px-3 py-2">{cancelled ? "Cancelled" : t.status}</td>
                  <td className="px-3 py-2 text-right">
                    {!cancelled && t.status !== "completed" && active.length > 1 && (
                      <button disabled={busy === t.id} className="rounded border border-red-300 px-2 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50" onClick={() => cancel(t.id)}>
                        {busy === t.id ? "…" : "Cancel trip"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
