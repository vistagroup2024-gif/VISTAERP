"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { VEHICLE_STATUS_LABEL, VEHICLE_STATUSES } from "../lib";
import PageHeader from "@/components/PageHeader";
import FormSection, { Field } from "@/components/ui/FormSection";

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
    <div className="max-w-4xl">
      <PageHeader title={existing ? "Edit Vehicle" : "New Vehicle"} subtitle="Vehicle master record, purchase and stock status" />
      <form onSubmit={save} className="card space-y-6">
        {err && <div className="rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{err}</div>}

        <FormSection title="Vehicle" cols={3}>
          <Field label="Make"><input className="input" value={f.make} onChange={(e) => set("make", e.target.value)} /></Field>
          <Field label="Model"><input className="input" value={f.model} onChange={(e) => set("model", e.target.value)} /></Field>
          <Field label="Variant"><input className="input" value={f.variant} onChange={(e) => set("variant", e.target.value)} /></Field>
          <Field label="Model Year"><input type="number" className="input" value={f.model_year} onChange={(e) => set("model_year", e.target.value)} /></Field>
          <Field label="Color"><input className="input" value={f.color} onChange={(e) => set("color", e.target.value)} /></Field>
          <Field label="Plate Number"><input className="input" value={f.plate_no} onChange={(e) => set("plate_no", e.target.value)} /></Field>
          <Field label="VIN / Chassis"><input className="input" value={f.vin} onChange={(e) => set("vin", e.target.value)} /></Field>
          <Field label="Engine Number"><input className="input" value={f.engine_no} onChange={(e) => set("engine_no", e.target.value)} /></Field>
          <Field label="Current Location"><input className="input" value={f.current_location} onChange={(e) => set("current_location", e.target.value)} /></Field>
        </FormSection>

        <FormSection title="Purchase" cols={3}>
          <Field label="Supplier">
            <select className="input" value={f.supplier_id} onChange={(e) => set("supplier_id", e.target.value)}>
              <option value="">— none —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Purchase Date"><input type="date" className="input" value={f.purchase_date} onChange={(e) => set("purchase_date", e.target.value)} /></Field>
          <div></div>
          <Field label="Purchase Cost (SAR)"><input type="number" step="0.01" className="input" value={f.purchase_cost} onChange={(e) => set("purchase_cost", e.target.value)} /></Field>
          <Field label="Purchase VAT (SAR)"><input type="number" step="0.01" className="input" value={f.purchase_vat} onChange={(e) => set("purchase_vat", e.target.value)} /></Field>
          <Field label="Total Cost (auto)"><input className="input bg-slate-50" value={totalCost.toFixed(2)} readOnly tabIndex={-1} /></Field>
        </FormSection>

        <FormSection title="Status" cols={3}>
          <Field label="Stock Status">
            <select className="input" value={f.status} onChange={(e) => set("status", e.target.value)}>
              {VEHICLE_STATUSES.map((s) => <option key={s} value={s}>{VEHICLE_STATUS_LABEL[s]}</option>)}
            </select>
          </Field>
          <Field label="Ownership">
            <select className="input" value={f.ownership} onChange={(e) => set("ownership", e.target.value)}>
              <option value="vista">Vista-owned</option>
              <option value="transferred">Transferred</option>
            </select>
          </Field>
          <Field label="Notes" full><textarea className="input" rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
          <p className="text-xs text-slate-400 sm:col-span-full">Reserved / Sold / Delivered / Held statuses are normally set automatically by the sale, delivery and holding flows in later steps.</p>
        </FormSection>

        <div className="flex gap-2 border-t border-slate-100 pt-4">
          <button className="btn" disabled={saving}>{saving ? "Saving…" : existing ? "Save changes" : "Create vehicle"}</button>
          <button type="button" className="btn-outline" onClick={() => router.back()}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
