"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Brn, Consumption, nightsBetween, usedOnNight, fmtDay, cellClass } from "@/lib/brn";
import { dateStr } from "@/lib/format";

export default function ConsumeForm({
  brns, cons, preselect,
}: { brns: Brn[]; cons: Consumption[]; preselect: string }) {
  const router = useRouter();
  const supabase = createClient();

  const [brnId, setBrnId] = useState(preselect);
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [beds, setBeds] = useState(0);
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const brn = brns.find((b) => b.id === brnId);
  const ownCons = useMemo(() => cons.filter((c) => c.brn_id === brnId), [cons, brnId]);

  // Live preview of availability for the requested stay
  const preview = useMemo(() => {
    if (!brn || !checkIn || !checkOut || checkOut <= checkIn) return null;
    if (checkIn < brn.check_in || checkOut > brn.check_out) return { outOfRange: true, nights: [] as any[] };
    const nights = nightsBetween(checkIn, checkOut).map((day) => {
      const used = usedOnNight(day, ownCons);
      const available = brn.beds - used;
      return { day, used, available };
    });
    return { outOfRange: false, nights };
  }, [brn, checkIn, checkOut, ownCons]);

  const minAvail = preview && !preview.outOfRange && preview.nights.length
    ? Math.min(...preview.nights.map((n) => n.available)) : null;
  const enough = minAvail === null ? true : minAvail >= beds;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!brnId) return setError("Select a BRN");
    if (!checkIn || !checkOut) return setError("Enter check-in and check-out");
    if (checkOut <= checkIn) return setError("Check-out must be after check-in");
    if (beds <= 0) return setError("Beds required must be greater than zero");

    setSaving(true);
    setError(null);
    const { error } = await supabase.rpc("consume_brn", {
      p_brn: brnId,
      p_check_in: checkIn,
      p_check_out: checkOut,
      p_beds: beds,
      p_reference: reference.trim() || null,
      p_remarks: null,
    });
    setSaving(false);
    if (error) return setError(error.message);
    router.push(`/inventory/brn/${brnId}`);
    router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-5">
      {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="card space-y-4">
        <div>
          <label className="label">BRN (hotel agreement)</label>
          <select className="input" value={brnId} onChange={(e) => setBrnId(e.target.value)} required>
            <option value="">Select a BRN…</option>
            {brns.map((b) => (
              <option key={b.id} value={b.id}>
                {b.brn} — {b.hotel_name} ({dateStr(b.check_in)}→{dateStr(b.check_out)}, {b.beds} beds)
              </option>
            ))}
          </select>
          {brn && (
            <p className="mt-1 text-xs text-slate-400">
              Valid stay window: {dateStr(brn.check_in)} → {dateStr(brn.check_out)}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Check-in</label>
            <input className="input" type="date" value={checkIn} min={brn?.check_in}
              max={brn?.check_out} onChange={(e) => setCheckIn(e.target.value)} required />
          </div>
          <div>
            <label className="label">Check-out</label>
            <input className="input" type="date" value={checkOut} min={checkIn || brn?.check_in}
              max={brn?.check_out} onChange={(e) => setCheckOut(e.target.value)} required />
          </div>
          <div>
            <label className="label">Beds required (pilgrims)</label>
            <input className="input" type="number" min={1} value={beds || ""}
              onChange={(e) => setBeds(Number(e.target.value))} required />
          </div>
          <div>
            <label className="label">Reference (package / group)</label>
            <input className="input" value={reference} placeholder="Optional"
              onChange={(e) => setReference(e.target.value)} />
          </div>
        </div>
      </div>

      {preview?.outOfRange && (
        <div className="rounded bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
          Requested stay is outside this BRN’s date range.
        </div>
      )}

      {preview && !preview.outOfRange && preview.nights.length > 0 && (
        <div className="card overflow-x-auto">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-semibold text-slate-700">Availability preview</p>
            <p className={`text-sm font-medium ${enough ? "text-green-600" : "text-red-600"}`}>
              {enough ? `✓ Enough (tightest night: ${minAvail} free)` : `✗ Short — only ${minAvail} free on tightest night`}
            </p>
          </div>
          <table className="min-w-max text-center text-sm">
            <thead>
              <tr>
                <th className="th text-left">Night</th>
                {preview.nights.map((n) => <th key={n.day} className="th px-3 whitespace-nowrap">{fmtDay(n.day)}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="td text-left font-medium text-slate-500">Available now</td>
                {preview.nights.map((n) => (
                  <td key={n.day} className={`td ${cellClass(n.available, brn!.beds)}`}>{n.available}</td>
                ))}
              </tr>
              <tr>
                <td className="td text-left font-medium text-slate-500">After this</td>
                {preview.nights.map((n) => {
                  const after = n.available - beds;
                  return <td key={n.day} className={`td ${cellClass(after, brn!.beds)}`}>{after}</td>;
                })}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="flex gap-2">
        <button className="btn" disabled={saving || !enough}>{saving ? "Booking…" : "Confirm consumption"}</button>
        <button type="button" className="btn-outline" onClick={() => router.back()}>Cancel</button>
      </div>
    </form>
  );
}
