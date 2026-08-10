"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fmtTime12 } from "@/lib/format";

interface TripInfo { trip_id: string; route: string; started?: string; free_at?: string; drop?: string; date?: string; time?: string; start?: string; pickup?: string; status?: string }
interface Row {
  driver_id: string; name: string; mobile: string | null; vehicle: string | null;
  location: string | null; city: string | null; driver_status: string;
  current_trip: TripInfo | null; next_trip: TripInfo | null;
  today_total: number; today_done: number; today_remaining: number;
}

const STATUS: Record<string, { label: string; dot: string; chip: string }> = {
  on_trip: { label: "On Trip", dot: "bg-cyan-500", chip: "bg-cyan-100 text-cyan-700" },
  available: { label: "Available", dot: "bg-green-500", chip: "bg-green-100 text-green-700" },
  resting: { label: "Resting", dot: "bg-amber-500", chip: "bg-amber-100 text-amber-700" },
  off: { label: "Off Duty", dot: "bg-slate-400", chip: "bg-slate-200 text-slate-600" },
};

function fmtTime(iso?: string) { return fmtTime12(iso) || "—"; }

export default function DriverDashboard({ rows, locations }: { rows: Row[]; locations: string[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState<string>("");
  const [move, setMove] = useState<Row | null>(null);
  const [to, setTo] = useState(""); const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = { on_trip: 0, available: 0, resting: 0, off: 0 };
    rows.forEach((r) => (c[r.driver_status] = (c[r.driver_status] ?? 0) + 1));
    return c;
  }, [rows]);

  const filtered = rows.filter((r) =>
    (!q || r.name.toLowerCase().includes(q.toLowerCase()) || (r.vehicle ?? "").toLowerCase().includes(q.toLowerCase()) || (r.city ?? "").toLowerCase().includes(q.toLowerCase()))
    && (!fStatus || r.driver_status === fStatus));

  async function submitMove() {
    if (!move || !to.trim()) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("transport_log_driver_movement", { p_driver: move.driver_id, p_to: to.trim(), p_reason: reason.trim() || null });
    setBusy(false);
    if (error) return setErr(error.message);
    setMove(null); setTo(""); setReason(""); router.refresh();
  }

  return (
    <div className="space-y-4">
      {/* summary */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(["on_trip", "available", "resting", "off"] as const).map((k) => (
          <button key={k} onClick={() => setFStatus(fStatus === k ? "" : k)}
            className={`card flex items-center gap-2 py-3 ${fStatus === k ? "ring-2 ring-brand" : ""}`}>
            <span className={`h-2.5 w-2.5 rounded-full ${STATUS[k].dot}`} />
            <span className="text-2xl font-bold text-slate-800">{counts[k] ?? 0}</span>
            <span className="text-sm text-slate-500">{STATUS[k].label}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Search driver, vehicle, city…" value={q} onChange={(e) => setQ(e.target.value)} />
        {fStatus && <button onClick={() => setFStatus("")} className="text-sm text-slate-500 hover:underline">Clear</button>}
        <span className="ml-auto text-sm text-slate-500">{filtered.length} of {rows.length} drivers</span>
      </div>
      {err && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((r) => {
          const st = STATUS[r.driver_status] ?? STATUS.off;
          return (
            <div key={r.driver_id} className="card space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-slate-800">{r.name}</div>
                  <div className="text-xs text-slate-500">{r.vehicle ?? "No vehicle"}{r.mobile ? ` · ${r.mobile}` : ""}</div>
                </div>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${st.chip}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />{st.label}
                </span>
              </div>

              <div className="flex items-center gap-1 text-sm text-slate-600">
                <span>📍</span><span className="font-medium">{r.location ?? "Unknown"}</span>
                {r.city && r.city !== r.location && <span className="text-slate-400">({r.city})</span>}
              </div>

              {r.current_trip ? (
                <div className="rounded-lg bg-cyan-50 px-3 py-2 text-sm">
                  <div className="font-medium text-cyan-800">🚐 {r.current_trip.route}</div>
                  <div className="text-xs text-cyan-700">Started {fmtTime(r.current_trip.started)} · frees ~ {fmtTime(r.current_trip.free_at)}{r.current_trip.drop ? ` at ${r.current_trip.drop}` : ""}</div>
                </div>
              ) : (
                <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">No trip in progress.</div>
              )}

              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">
                  {r.next_trip ? <>Next: <span className="font-medium text-slate-700">{r.next_trip.route}</span> · {r.next_trip.time}{r.next_trip.date ? ` (${r.next_trip.date})` : ""}</> : "No further trips"}
                </span>
              </div>

              <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-xs text-slate-500">
                <span>Today: <b className="text-slate-700">{r.today_done}</b>/{r.today_total} done · {r.today_remaining} left</span>
                <button onClick={() => { setMove(r); setTo(""); setReason(""); setErr(null); }} className="font-medium text-brand hover:underline">↪ Move Driver</button>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && <div className="card text-slate-400">No drivers match.</div>}
      </div>

      {/* Move Driver modal */}
      {move && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setMove(null)}>
          <div className="w-full max-w-md space-y-3 rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-slate-800">Move {move.name}</h3>
            <p className="text-xs text-slate-500">Log a repositioning move (no booking). Current location: <b>{move.location ?? "Unknown"}</b>. The system updates the driver&apos;s location so future assignments know where they are.</p>
            <div>
              <label className="label">Move to *</label>
              <input className="input" list="loc-list" value={to} onChange={(e) => setTo(e.target.value)} placeholder="e.g. Makkah" />
              <datalist id="loc-list">{locations.map((l) => <option key={l} value={l} />)}</datalist>
            </div>
            <div><label className="label">Reason (optional)</label><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. repositioned after airport drop" /></div>
            {err && <p className="text-sm text-red-600">{err}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setMove(null)} className="btn-outline text-sm">Cancel</button>
              <button onClick={submitMove} disabled={busy || !to.trim()} className="btn text-sm">{busy ? "Saving…" : "Save Movement"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
