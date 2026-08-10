"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { fmtTime12 } from "@/lib/format";

interface Trip {
  trip_id: string; booking_no: string | null; passenger_name: string | null; mobile: string | null; pax: number | null;
  route: string | null; pickup: string | null; drop: string | null; flight_no: string | null;
  trip_date: string | null; trip_time: string | null; status: string; vehicle: string | null;
}

const NEXT: Record<string, { to: string; label: string }> = {
  assigned: { to: "on_route", label: "Start Trip" },
  outsourced: { to: "on_route", label: "Start Trip" },
  on_route: { to: "picked_up", label: "Passenger Picked Up" },
  picked_up: { to: "completed", label: "Complete Trip" },
};
const CHIP: Record<string, string> = {
  assigned: "bg-indigo-100 text-indigo-700", on_route: "bg-cyan-100 text-cyan-700",
  picked_up: "bg-teal-100 text-teal-700", completed: "bg-green-100 text-green-700",
  pending: "bg-amber-100 text-amber-700", cancelled: "bg-red-100 text-red-700",
};

function todayISO(off = 0) { return new Date(Date.now() + off * 86400000).toISOString().slice(0, 10); }

export default function DriverPortal() {
  const [driver, setDriver] = useState<{ name: string; vehicle?: string } | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [date, setDate] = useState(todayISO());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async (d: string) => {
    setLoading(true);
    const res = await fetch("/api/driver", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "list", date: d }) });
    if (res.status === 401) { window.location.href = "/login"; return; }
    const j = await res.json().catch(() => ({}));
    setDriver(j.driver ?? null); setTrips(j.trips ?? []); setLoading(false);
  }, []);

  useEffect(() => { load(date); }, [date, load]);

  async function setStatus(trip_id: string, status: string) {
    setBusy(trip_id); setMsg(null);
    const res = await fetch("/api/driver", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "status", trip_id, status }) });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { setMsg(j.error || "Could not update."); return; }
    load(date);
  }
  async function logout() { await fetch("/api/driver/logout", { method: "POST" }); window.location.href = "/login"; }

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
        <div className="flex items-center gap-2">
          <Image src="/icon.svg" alt="Vista Group" width={32} height={32} />
          <div><p className="text-sm font-bold text-slate-800 leading-tight">Vista Transport — Driver</p>
            <p className="text-xs text-slate-400 leading-tight">{driver?.name ?? ""}{driver?.vehicle ? ` · ${driver.vehicle}` : ""}</p></div>
        </div>
        <button onClick={logout} className="btn-outline text-sm">Sign out</button>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 p-4">
        <div className="flex items-center gap-2">
          <button className={`rounded-md px-3 py-1.5 text-sm font-medium ${date === todayISO() ? "bg-brand text-white" : "border border-slate-200 bg-white"}`} onClick={() => setDate(todayISO())}>Today</button>
          <button className={`rounded-md px-3 py-1.5 text-sm font-medium ${date === todayISO(1) ? "bg-brand text-white" : "border border-slate-200 bg-white"}`} onClick={() => setDate(todayISO(1))}>Tomorrow</button>
          <input type="date" className="input px-2 py-1.5 text-sm" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </div>
        {msg && <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{msg}</div>}

        {loading ? <p className="text-sm text-slate-400">Loading…</p>
          : trips.length === 0 ? <div className="card text-slate-400">No trips for this day.</div>
          : trips.map((t) => (
            <div key={t.trip_id} className="card">
              <div className="flex items-baseline justify-between gap-2">
                <div className="font-semibold text-slate-800">{t.route ?? "—"}</div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CHIP[t.status] ?? "bg-slate-200"}`}>{t.status.replace(/_/g, " ")}</span>
              </div>
              <div className="mt-1 text-sm text-slate-500">{fmtTime12(t.trip_time)}{t.flight_no ? ` · ✈️ ${t.flight_no}` : ""}</div>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-600">
                <div><span className="text-xs text-slate-400">Passenger</span><div>{t.passenger_name ?? "—"} ({t.pax ?? "—"})</div></div>
                <div><span className="text-xs text-slate-400">Mobile</span><div>{t.mobile ? <a href={`tel:${t.mobile}`} className="text-brand">{t.mobile}</a> : "—"}</div></div>
                <div><span className="text-xs text-slate-400">Pickup</span><div>{t.pickup ?? "—"}</div></div>
                <div><span className="text-xs text-slate-400">Drop</span><div>{t.drop ?? "—"}</div></div>
              </div>
              {NEXT[t.status] && (
                <button onClick={() => setStatus(t.trip_id, NEXT[t.status].to)} disabled={busy === t.trip_id} className="btn mt-3 w-full text-sm">
                  {busy === t.trip_id ? "…" : NEXT[t.status].label}
                </button>
              )}
            </div>
          ))}
      </div>
    </main>
  );
}
