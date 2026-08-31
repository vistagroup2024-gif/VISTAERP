"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PO_STATUS_LABEL, sar } from "../lib";
import PageHeader from "@/components/PageHeader";
import FormSection, { Field } from "@/components/ui/FormSection";

interface Opt { id: string; name: string }
interface Line { id?: string; make: string; model: string; variant: string; model_year: string; color: string; vin: string; plate_no: string; engine_no: string; purchase_cost: string; purchase_vat: string; received?: boolean }

const blank = (): Line => ({ make: "", model: "", variant: "", model_year: "", color: "", vin: "", plate_no: "", engine_no: "", purchase_cost: "", purchase_vat: "" });

export default function PurchaseOrderForm({ existing, items = [], suppliers }: { existing: any | null; items?: any[]; suppliers: Opt[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [h, setH] = useState({
    supplier_id: existing?.supplier_id ?? "",
    po_date: existing?.po_date ?? new Date().toISOString().slice(0, 10),
    expected_date: existing?.expected_date ?? "",
    status: existing?.status ?? "draft",
    notes: existing?.notes ?? "",
  });
  const [lines, setLines] = useState<Line[]>(items.length ? items.map((i) => ({
    id: i.id, make: i.make ?? "", model: i.model ?? "", variant: i.variant ?? "", model_year: i.model_year ?? "",
    color: i.color ?? "", vin: i.vin ?? "", plate_no: i.plate_no ?? "", engine_no: i.engine_no ?? "",
    purchase_cost: i.purchase_cost ?? "", purchase_vat: i.purchase_vat ?? "", received: i.received,
  })) : [blank()]);

  const setL = (i: number, k: keyof Line, v: any) => setLines((a) => a.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));
  const total = useMemo(() => lines.reduce((a, l) => a + (Number(l.purchase_cost) || 0) + (Number(l.purchase_vat) || 0), 0), [lines]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErr(null);
    const payloadItems = lines.map((l, i) => ({ ...l, model_year: String(l.model_year || ""), sort: String(i) }));
    const { data, error } = await supabase.rpc("car_po_save", { p_id: existing?.id ?? null, p_header: h, p_items: payloadItems });
    setSaving(false);
    if (error) return setErr(error.message);
    router.push(`/car-sales/purchases/${data}`);
    router.refresh();
  }

  return (
    <div className="max-w-5xl">
      <PageHeader title={existing ? "Edit Purchase Order" : "New Purchase Order"} subtitle="Supplier order and vehicle lines" />
      <form onSubmit={save} className="space-y-6">
      {err && <div className="rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{err}</div>}

      <div className="card space-y-6">
        <FormSection title="Purchase Order" cols={3}>
          <Field label="Supplier">
            <select className="input" value={h.supplier_id} onChange={(e) => setH({ ...h, supplier_id: e.target.value })}>
              <option value="">— none —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="PO Date"><input type="date" className="input" value={h.po_date} onChange={(e) => setH({ ...h, po_date: e.target.value })} /></Field>
          <Field label="Expected Date"><input type="date" className="input" value={h.expected_date} onChange={(e) => setH({ ...h, expected_date: e.target.value })} /></Field>
          <Field label="Status">
            <select className="input" value={h.status} onChange={(e) => setH({ ...h, status: e.target.value })} disabled={existing?.status === "received"}>
              {["draft", "ordered"].map((s) => <option key={s} value={s}>{PO_STATUS_LABEL[s]}</option>)}
              {existing?.status === "received" && <option value="received">Received</option>}
            </select>
          </Field>
          <Field label="Notes" full><input className="input" value={h.notes} onChange={(e) => setH({ ...h, notes: e.target.value })} /></Field>
        </FormSection>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-700">Vehicles ({lines.length})</h2>
          <button type="button" className="btn-outline text-sm" onClick={() => setLines((a) => [...a, blank()])}>+ Add vehicle</button>
        </div>
        {lines.map((l, i) => (
          <div key={i} className={`card space-y-3 ${l.received ? "border-l-4 border-emerald-400" : "border-l-4 border-brand/60"}`}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-600">Vehicle {i + 1}{l.received ? " · received" : ""}</h3>
              {!l.received && lines.length > 1 && <button type="button" className="text-sm text-red-500 hover:underline" onClick={() => setLines((a) => a.filter((_, idx) => idx !== i))}>Remove</button>}
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <input className="input" placeholder="Make" value={l.make} disabled={l.received} onChange={(e) => setL(i, "make", e.target.value)} />
              <input className="input" placeholder="Model" value={l.model} disabled={l.received} onChange={(e) => setL(i, "model", e.target.value)} />
              <input className="input" placeholder="Variant" value={l.variant} disabled={l.received} onChange={(e) => setL(i, "variant", e.target.value)} />
              <input type="number" className="input" placeholder="Year" value={l.model_year} disabled={l.received} onChange={(e) => setL(i, "model_year", e.target.value)} />
              <input className="input" placeholder="Color" value={l.color} disabled={l.received} onChange={(e) => setL(i, "color", e.target.value)} />
              <input className="input" placeholder="VIN / Chassis" value={l.vin} disabled={l.received} onChange={(e) => setL(i, "vin", e.target.value)} />
              <input className="input" placeholder="Plate" value={l.plate_no} disabled={l.received} onChange={(e) => setL(i, "plate_no", e.target.value)} />
              <input className="input" placeholder="Engine No" value={l.engine_no} disabled={l.received} onChange={(e) => setL(i, "engine_no", e.target.value)} />
              <div><label className="label">Cost (SAR)</label><input type="number" step="0.01" className="input" value={l.purchase_cost} disabled={l.received} onChange={(e) => setL(i, "purchase_cost", e.target.value)} /></div>
              <div><label className="label">VAT (SAR)</label><input type="number" step="0.01" className="input" value={l.purchase_vat} disabled={l.received} onChange={(e) => setL(i, "purchase_vat", e.target.value)} /></div>
              <div className="flex items-end text-sm text-slate-500">Total {sar((Number(l.purchase_cost) || 0) + (Number(l.purchase_vat) || 0))}</div>
            </div>
          </div>
        ))}
        <div className="card flex justify-end text-sm">PO Total: <b className="ml-2">{sar(total)}</b></div>
      </section>

      <div className="flex gap-2 border-t border-slate-100 pt-4">
        <button className="btn" disabled={saving}>{saving ? "Saving…" : existing ? "Save changes" : "Create purchase order"}</button>
        <button type="button" className="btn-outline" onClick={() => router.back()}>Cancel</button>
      </div>
      </form>
    </div>
  );
}
