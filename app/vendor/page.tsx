"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";

interface Trip {
  id: string; route_name: string | null; route_label: string | null; trip_date: string | null; trip_time: string | null;
  pickup_location: string | null; drop_location: string | null; flight_no: string | null;
  booking_no: string | null; passenger_name: string | null; mobile: string | null; pax: number | null; status?: string;
}

export default function VendorPortal() {
  const [vendor, setVendor] = useState<{ name: string } | null>(null);
  const [available, setAvailable] = useState<Trip[]>([]);
  const [mine, setMine] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/vendor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "list" }) });
    if (res.status === 401) { window.location.href = "/login"; return; }
    const j = await res.json().catch(() => ({}));
    setVendor(j.vendor ?? null); setAvailable(j.available ?? []); setMine(j.mine ?? []); setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function accept(id: string) {
    setBusy(id); setMsg(null);
    const res = await fetch("/api/vendor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "accept", id }) });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { setMsg(j.error || "Could not accept — it may have been taken."); }
    await load();
  }
  async function logout() { await fetch("/api/vendor/logout", { method: "POST" }); window.location.href = "/login"; }

  const route = (t: Trip) => t.route_name ?? t.route_label ?? "—";
  const when = (t: Trip) => `${t.trip_date ?? "—"} ${t.trip_time?.slice(0, 5) ?? ""}`;

  const Card = ({ t, action }: { t: Trip; action?: React.ReactNode }) => (
    <div className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-semibold text-slate-800">{route(t)}</div>
        <div className="text-sm text-slate-500">{when(t)}</div>
      </div>
      <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-600 sm:grid-cols-4">
        <div><span className="text-xs text-slate-400">Booking</span><div>{t.booking_no ?? "—"}</div></div>
        <div><span className="text-xs text-slate-400">Passenger</span><div>{t.passenger_name ?? "—"} ({t.pax ?? "—"})</div></div>
        <div className="sm:col-span-1"><span className="text-xs text-slate-400">Pickup</span><div>{t.pickup_location ?? "—"}</div></div>
        <div className="sm:col-span-1"><span className="text-xs text-slate-400">Drop</span><div>{t.drop_location ?? "—"}</div></div>
        {t.flight_no && <div><span className="text-xs text-slate-400">Flight</span><div>{t.flight_no}</div></div>}
      </div>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex items-center gap-2">
          <Image src="/icon.svg" alt="Vista Group" width={32} height={32} />
          <div><p className="text-sm font-bold text-slate-800 leading-tight">Vista Transport — Vendor Portal</p>
            <p className="text-xs text-slate-400 leading-tight">{vendor?.name ?? ""}</p></div>
        </div>
        <button onClick={logout} className="btn-outline text-sm">Sign out</button>
      </header>

      <div className="mx-auto max-w-4xl space-y-6 p-6">
        {msg && <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{msg}</div>}

        <section>
          <h2 className="mb-2 font-semibold text-slate-700">Available outsourced trips</h2>
          {loading ? <p className="text-sm text-slate-400">Loading…</p>
            : available.length === 0 ? <div className="card text-slate-400">No trips available right now.</div>
            : <div className="space-y-3">{available.map((t) => (
                <Card key={t.id} t={t} action={<button onClick={() => accept(t.id)} disabled={busy === t.id} className="btn text-sm">{busy === t.id ? "…" : "Confirm Assignment"}</button>} />
              ))}</div>}
        </section>

        <section>
          <h2 className="mb-2 font-semibold text-slate-700">My accepted trips</h2>
          {mine.length === 0 ? <div className="card text-slate-400">You haven’t accepted any trips yet.</div>
            : <div className="space-y-3">{mine.map((t) => (
                <Card key={t.id} t={t} action={<span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-medium text-teal-700">{(t.status ?? "outsourced").replace("_", " ")}</span>} />
              ))}</div>}
        </section>
      </div>
    </main>
  );
}
