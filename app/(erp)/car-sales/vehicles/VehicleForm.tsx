"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { VEHICLE_STATUS_LABEL, VEHICLE_STATUSES } from "../lib";

interface Opt { id: string; name: string }

export default function VehicleForm({ existing, suppliers }: { existing: any | null; suppliers: Opt[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({
    make: existing?.make ?? "",
    model: existing?.model ?? "",
    variant: existing?.variant ?? "",
    model_year: existing?.model_year ?? "",
    color: existing?.color ?? "",
    plate_no: existing?.plate_no ?? "",
    vin: existing?.vin ?? "",
    engine_no: existing?.engine_no ?? "",
    supplier_id: existing?.supplier_id ?? "",
    purchase_date: existing?.purchase_date ?? "",
    purchase_cost: existing?.purchase_cost ?? "",
    purchase_vat: existing?.purchase_vat ?? "",
    current_location: existing?.current_location ?? "",
    status: existing?.status ?? "in_stock",
    ownership: existing?.ownership ?? "vista",
    notes: existing?.notes ?? "",
  });
  const set = (k: string, v: any) => setF((s) => ({ ...s, [k]: v }));
  const totalCost = useMemo(() => (Number(f.purchase_cost) || 0) + (Number(f.purchase_vat) || 0), [f.purchase_cost, f.purchase_vat]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErr(null);
    const { data, error } = await supabase.rpc("car_vehicle_save", { p_id: existing?.id ?? null, p: { ...f, model_year: String(f.model_year || "") } });
    setSaving(false);
    if (error) return setErr(error.message);
    router.push(`/car-sales/vehicles/${data}`);
    router.refresh();
  }

  return (
    <form onSubmit={save} className="max-w-4xl space-y-6">
      {err && <div className="rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{err}</div>}

      <section className="card space-y-4">
        <h2 className="font-semibold text-slate-700">Vehicle</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div><label className="label">Make</label><input className="input" value={f.make} onChange={(e) => set("make", e.target.value)} /></div>
          <div><label className="label">Model</label><input className="input" value={f.model} onChange={(e) => set("model", e.target.value)} /></div>
          <div><label className="label">Variant</label><input className="input" value={f.variant} onChange={(e) => set("variant", e.target.value)} /></div>
          <div><label className="label">Model Year</label><input type="number" className="input" value={f.model_year} onChange={(e) => set("model_year", e.target.value)} /></div>
          <div><label className="label">Color</label><input className="input" value={f.color} onChange={(e) => set("color", e.target.value)} /></div>
          <div><label className="label">Plate Number</label><input className="input" value={f.plate_no} onChange={(e) => set("plate_no", e.target.value)} /></div>
          <div><label className="label">VIN / Chassis</label><input className="input" value={f.vin} onChange={(e) => set("vin", e.target.value)} /></div>
          <div><label className="label">Engine Number</label><input className="input" value={f.engine_no} onChange={(e) => set("engine_no", e.target.value)} /></div>
          <div><label className="label">Current Location</label><input className="input" value={f.current_location} onChange={(e) => set("current_location", e.target.value)} /></div>
        </div>
      </section>

      <section className="card space-y-4">
        <h2 className="font-semibold text-slate-700">Purchase</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className="label">Supplier</label>
            <select className="input" value={f.supplier_id} onChange={(e) => set("supplier_id", e.target.value)}>
              <option value="">— none —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div><label className="label">Purchase Date</label><input type="date" className="input" value={f.purchase_date} onChange={(e) => set("purchase_date", e.target.value)} /></div>
          <div></div>
          <div><label className="label">Purchase Cost (SAR)</label><input type="number" step="0.01" className="input" value={f.purchase_cost} onChange={(e) => set("purchase_cost", e.target.value)} /></div>
          <div><label className="label">Purchase VAT (SAR)</label><input type="number" step="0.01" className="input" value={f.purchase_vat} onChange={(e) => set("purchase_vat", e.target.value)} /></div>
          <div><label className="label">Total Cost <span className="text-slate-400">(auto)</span></label><input className="input bg-slate-50" value={totalCost.toFixed(2)} readOnly tabIndex={-1} /></div>
        </div>
      </section>

      <section className="card space-y-4">
        <h2 className="font-semibold text-slate-700">Status</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className="label">Stock Status</label>
            <select className="input" value={f.status} onChange={(e) => set("status", e.target.value)}>
              {VEHICLE_STATUSES.map((s) => <option key={s} value={s}>{VEHICLE_STATUS_LABEL[s]}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Ownership</label>
            <select className="input" value={f.ownership} onChange={(e) => set("ownership", e.target.value)}>
              <option value="vista">Vista-owned</option>
              <option value="transferred">Transferred</option>
            </select>
          </div>
          <div className="md:col-span-3"><label className="label">Notes</label><textarea className="input" rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></div>
        </div>
        <p className="text-xs text-slate-400">Reserved / Sold / Delivered / Held statuses are normally set automatically by the sale, delivery and holding flows in later steps.</p>
      </section>

      <div className="flex gap-2">
        <button className="btn" disabled={saving}>{saving ? "Saving…" : existing ? "Save changes" : "Create vehicle"}</button>
        <button type="button" className="btn-outline" onClick={() => router.back()}>Cancel</button>
      </div>
    </form>
  );
}
