"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface V { id: string; name: string; insurance_expiry: string | null; registration_expiry: string | null; next_service_date: string | null; odometer_km: number | null }

export default function FleetDocs({ initial }: { initial: V[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [rows, setRows] = useState<Record<string, any>>(Object.fromEntries(initial.map((v) => [v.id, {
    insurance_expiry: v.insurance_expiry ?? "", registration_expiry: v.registration_expiry ?? "",
    next_service_date: v.next_service_date ?? "", odometer_km: v.odometer_km ?? "",
  }])));
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function set(id: string, patch: any) { setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } })); }

  async function save(id: string) {
    setBusy(id); setErr(null);
    const r = rows[id];
    const { error } = await supabase.from("transport_vehicles").update({
      insurance_expiry: r.insurance_expiry || null, registration_expiry: r.registration_expiry || null,
      next_service_date: r.next_service_date || null, odometer_km: r.odometer_km === "" ? null : Number(r.odometer_km),
    }).eq("id", id);
    setBusy(null);
    if (error) return setErr(error.message);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr><th className="th">Vehicle</th><th className="th">Insurance expiry</th><th className="th">Registration expiry</th><th className="th">Next service</th><th className="th">Odometer (km)</th><th className="th"></th></tr></thead>
          <tbody>
            {initial.map((v) => (
              <tr key={v.id} className="border-t border-slate-100">
                <td className="td font-medium">{v.name}</td>
                <td className="td"><input className="input" type="date" value={rows[v.id]?.insurance_expiry ?? ""} onChange={(e) => set(v.id, { insurance_expiry: e.target.value })} /></td>
                <td className="td"><input className="input" type="date" value={rows[v.id]?.registration_expiry ?? ""} onChange={(e) => set(v.id, { registration_expiry: e.target.value })} /></td>
                <td className="td"><input className="input" type="date" value={rows[v.id]?.next_service_date ?? ""} onChange={(e) => set(v.id, { next_service_date: e.target.value })} /></td>
                <td className="td"><input className="input w-24" type="number" value={rows[v.id]?.odometer_km ?? ""} onChange={(e) => set(v.id, { odometer_km: e.target.value })} /></td>
                <td className="td"><button onClick={() => save(v.id)} disabled={busy === v.id} className="text-sm font-medium text-brand hover:underline">{busy === v.id ? "…" : "Save"}</button></td>
              </tr>
            ))}
            {initial.length === 0 && <tr><td className="td text-slate-400" colSpan={6}>Add vehicles first.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
