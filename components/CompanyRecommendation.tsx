"use client";

import { useCallback, useEffect, useState } from "react";
import { dateStr } from "@/lib/format";

export interface RecoResult {
  id: string;
  name: string;
  complete: boolean;
  covered_nights: number;
  total_nights: number;
  pct: number;
  available_bed_nights: number;
  min_beds: number;
  reserved_beds: number;
  recommended?: boolean;
  is_fallback?: boolean;
}
export interface Reservation {
  id: string;
  company: string;
  group_company_id: string;
  arrival_date: string;
  departure_date: string;
  pax: number;
  source: string;
  created_by: string | null;
  expires_at: string;
}

// Shared Company Recommendation tool used by BOTH the Admin and Agent portals.
// `endpoint` is the POST route that proxies to the recommend/reserve/list RPCs
// (admin vs agent differ only in auth). `canConfig` shows the expiry setting.
export default function CompanyRecommendation({
  endpoint, canConfig = false, canRelease = false, agentView = false,
}: { endpoint: string; canConfig?: boolean; canRelease?: boolean; agentView?: boolean }) {
  const [arrival, setArrival] = useState("");
  const [departure, setDeparture] = useState("");
  const [pax, setPax] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<RecoResult[] | null>(null);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [minutes, setMinutes] = useState<string>("");
  const [reserveHours, setReserveHours] = useState<number>(1);

  const post = useCallback(async (body: any) => {
    const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Request failed");
    return json;
  }, [endpoint]);

  const loadReservations = useCallback(async () => {
    try { const j = await post({ action: "list" }); setReservations(j.reservations ?? []); if (j.minutes != null) setMinutes(String(j.minutes)); }
    catch { /* ignore */ }
  }, [post]);

  useEffect(() => { loadReservations(); }, [loadReservations]);

  const nights = arrival && departure && departure > arrival
    ? Math.round((+new Date(departure) - +new Date(arrival)) / 86400000) : 0;

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setMsg(null);
    if (!arrival || !departure) return setError("Enter arrival and departure dates.");
    if (departure <= arrival) return setError("Departure must be after arrival.");
    if (Number(pax) <= 0) return setError("Enter number of pax.");
    setLoading(true); setResults(null);
    try {
      const j = await post({ action: "recommend", arrival, departure, pax: Number(pax) });
      setResults(j.results ?? []);
      await loadReservations();
    } catch (err: any) { setError(err.message); } finally { setLoading(false); }
  }

  async function reserve(companyId: string) {
    setError(null); setMsg(null);
    try {
      await post({ action: "reserve", company: companyId, arrival, departure, pax: Number(pax), hours: reserveHours });
      setMsg(`Company reserved for ${reserveHours} hour(s). Create the Visa Group before it expires.`);
      const j = await post({ action: "recommend", arrival, departure, pax: Number(pax) });
      setResults(j.results ?? []);
      await loadReservations();
    } catch (err: any) { setError(err.message); }
  }

  async function release(id: string) {
    try { await post({ action: "release", id }); await loadReservations();
      if (arrival && departure && pax) { const j = await post({ action: "recommend", arrival, departure, pax: Number(pax) }); setResults(j.results ?? []); }
    } catch (err: any) { setError(err.message); }
  }

  async function saveMinutes() {
    try { await post({ action: "set_minutes", minutes: Number(minutes) }); setMsg("Reservation hold time updated."); }
    catch (err: any) { setError(err.message); }
  }

  const top = results && results.length ? results[0] : null;

  return (
    <div className="space-y-5">
      <form onSubmit={check} className="card space-y-4">
        <h2 className="font-semibold text-slate-700">Check Company Availability</h2>
        <p className="text-sm text-slate-500">Enter the stay and pax to find which company should be selected in Nusuk Masar based on current BRN availability. No Visa Group is created here.</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div>
            <label className="label">Arrival date</label>
            <input className="input" type="date" value={arrival} onChange={(e) => setArrival(e.target.value)} required />
          </div>
          <div>
            <label className="label">Departure date</label>
            <input className="input" type="date" min={arrival || undefined} value={departure} onChange={(e) => setDeparture(e.target.value)} required />
          </div>
          <div>
            <label className="label">Pax</label>
            <input className="input" type="number" min={1} value={pax || ""} onChange={(e) => setPax(Number(e.target.value))} required />
          </div>
          <div className="flex items-end">
            <button className="btn w-full" disabled={loading}>{loading ? "Checking…" : "Check Availability"}</button>
          </div>
        </div>
        {nights > 0 && <p className="text-xs text-slate-500">Stay: <b>{nights}</b> night(s).</p>}
        {error && <div className="rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{error}</div>}
        {msg && <div className="rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</div>}
      </form>

      {results && (
        <div className="card space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-slate-700">Recommendation</h2>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              Reservation duration
              <select className="input w-32" value={reserveHours} onChange={(e) => setReserveHours(Number(e.target.value))}>
                {[1, 2, 3, 4, 5, 6].map((h) => <option key={h} value={h}>{h} Hour{h > 1 ? "s" : ""}{h === 6 ? " (Max)" : ""}</option>)}
              </select>
            </label>
          </div>
          {results.length === 0 && <p className="text-sm text-slate-400">No active companies to evaluate.</p>}
          {top && agentView && (
            <div className={`rounded-lg border p-4 ${top.is_fallback ? "border-amber-300 bg-amber-50" : "border-emerald-300 bg-emerald-50"}`}>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recommendation</p>
              <p className="mt-1 text-xl font-bold text-slate-800">{top.is_fallback ? `Feed in Company: ${top.name}` : `Use Company: ${top.name}`}</p>
              {top.is_fallback && <p className="text-sm text-slate-600">No company covers enough of the stay — feed this booking into <b>{top.name}</b>.</p>}
              <button onClick={() => reserve(top.id)} className="btn mt-3 text-sm">Reserve {top.name}</button>
            </div>
          )}
          {top && !agentView && (
            <div className={`rounded-lg border p-4 ${top.complete && !top.is_fallback ? "border-emerald-300 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recommended company</p>
              <p className="mt-1 text-xl font-bold text-slate-800">{top.name}</p>
              <p className="text-sm text-slate-600">
                {top.is_fallback
                  ? `No company covers enough of the required stay — feed this booking into ${top.name}.`
                  : top.complete
                    ? `Can complete the allocation (covers ${top.covered_nights}/${top.total_nights} nights).`
                    : `Covers ${top.pct}% of the stay (${top.covered_nights}/${top.total_nights} nights).`}
                {!top.is_fallback && <> {" "}Available inventory: <b>{top.available_bed_nights}</b> bed-nights.</>}
              </p>
              <button onClick={() => reserve(top.id)} className="btn mt-3 text-sm">Reserve {top.name}</button>
            </div>
          )}
          {!agentView && results.length > 1 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="th">Company</th><th className="th">Can Complete</th><th className="th">Coverage</th>
                    <th className="th">Available (bed-nights)</th><th className="th">Reserved</th><th className="th"></th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.id} className="border-t border-slate-100">
                      <td className="td font-medium">{r.name}</td>
                      <td className="td">{r.complete ? <span className="badge bg-emerald-100 text-emerald-700">Yes</span> : <span className="badge bg-slate-100 text-slate-500">No</span>}</td>
                      <td className="td">{r.pct}% ({r.covered_nights}/{r.total_nights})</td>
                      <td className="td">{r.available_bed_nights}</td>
                      <td className="td">{r.reserved_beds || "—"}</td>
                      <td className="td"><button onClick={() => reserve(r.id)} className="btn-outline text-xs">Reserve</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-700">Active Reservations</h2>
          <button onClick={loadReservations} className="btn-outline text-xs">Refresh</button>
        </div>
        {reservations.length === 0 && <p className="text-sm text-slate-400">No active reservations.</p>}
        {reservations.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Company</th><th className="th">Stay</th><th className="th">Pax</th>
                  <th className="th">By</th><th className="th">Expires</th>{canRelease && <th className="th"></th>}
                </tr>
              </thead>
              <tbody>
                {reservations.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="td font-medium">{r.company}</td>
                    <td className="td">{dateStr(r.arrival_date)} → {dateStr(r.departure_date)}</td>
                    <td className="td">{r.pax}</td>
                    <td className="td text-slate-500">{r.created_by || r.source}</td>
                    <td className="td">{new Date(r.expires_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
                    {canRelease && <td className="td"><button onClick={() => release(r.id)} className="text-xs text-red-600 hover:underline">Release</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canConfig && (
        <div className="card space-y-2">
          <h2 className="font-semibold text-slate-700">Settings</h2>
          <label className="label">Reservation hold time (minutes)</label>
          <div className="flex gap-2">
            <input className="input w-40" type="number" min={1} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            <button onClick={saveMinutes} className="btn-outline text-sm">Save</button>
          </div>
          <p className="text-xs text-slate-400">Reservations expire automatically after this many minutes, or when a Visa Group is created for the reserved company and dates.</p>
        </div>
      )}
    </div>
  );
}
