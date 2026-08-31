"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useUnsavedChanges, confirmDiscardIfDirty } from "@/lib/useUnsavedChanges";
import PageHeader from "@/components/PageHeader";
import FormSection, { Field } from "@/components/ui/FormSection";

export default function BrnEditForm({
  brn, suppliers, companies, consumedCount,
}: {
  brn: any;
  suppliers: { id: string; name: string }[];
  companies: { id: string; name: string }[];
  consumedCount: number;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [form, setForm] = useState({
    group_company_id: brn.group_company_id ?? "",
    hotel_name: brn.hotel_name ?? "",
    brn: brn.brn ?? "",
    city: brn.city ?? "Makkah",
    check_in: brn.check_in ?? "",
    check_out: brn.check_out ?? "",
    beds: brn.beds ?? 0,
    supplier_id: brn.supplier_id ?? "",
    rate_per_bed: brn.rate_per_bed ?? 0,
    cost_currency: brn.cost_currency ?? "SAR",
    remarks: brn.remarks ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const locked = consumedCount > 0;
  const savedRef = useRef(false);
  const initialRef = useRef(JSON.stringify(form));
  const dirty = !savedRef.current && JSON.stringify(form) !== initialRef.current;
  useUnsavedChanges(dirty);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (form.check_out <= form.check_in) return setError("Check-out must be after check-in");
    if (Number(form.beds) <= 0) return setError("Beds must be greater than zero");

    setSaving(true);
    setError(null);
    const { error } = await supabase.from("brn_inventory").update({
      group_company_id: form.group_company_id || null,
      hotel_name: form.hotel_name.trim(),
      brn: form.brn.trim(),
      city: form.city,
      check_in: form.check_in,
      check_out: form.check_out,
      beds: Number(form.beds),
      supplier_id: form.supplier_id || null,
      rate_per_bed: Number(form.rate_per_bed) || 0,
      cost_currency: form.cost_currency,
      remarks: form.remarks.trim() || null,
    }).eq("id", brn.id);
    setSaving(false);
    if (error) return setError(error.message);
    savedRef.current = true;
    router.push(`/inventory/brn/${brn.id}`);
    router.refresh();
  }

  return (
    <div className="max-w-lg">
      <PageHeader title="Edit BRN" subtitle="Update this hotel bed agreement" />
      {locked && (
        <div className="mb-4 rounded bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
          This BRN has consumed inventory. Dates, beds, and city can only be changed by a Super Admin.
        </div>
      )}
      <form onSubmit={save} className="card space-y-6">
        {error && <div className="rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{error}</div>}
        <FormSection title="Agreement">
          <Field label="Company" full>
            <select className="input" value={form.group_company_id} onChange={(e) => setForm({ ...form, group_company_id: e.target.value })} required>
              <option value="">Select company…</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Hotel name" full>
            <input className="input" value={form.hotel_name} onChange={(e) => setForm({ ...form, hotel_name: e.target.value })} required />
          </Field>
          <Field label="BRN">
            <input className="input font-mono" value={form.brn} onChange={(e) => setForm({ ...form, brn: e.target.value })} required />
          </Field>
          <Field label="City">
            <select className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })}>
              <option>Makkah</option><option>Madinah</option><option>Jeddah</option><option>Other</option>
            </select>
          </Field>
          <Field label="Check-in">
            <input className="input" type="date" value={form.check_in} onChange={(e) => setForm({ ...form, check_in: e.target.value })} required />
          </Field>
          <Field label="Check-out">
            <input className="input" type="date" value={form.check_out} min={form.check_in || undefined} onChange={(e) => setForm({ ...form, check_out: e.target.value })} required />
          </Field>
          <Field label="Beds">
            <input className="input" type="number" min={1} value={form.beds || ""} onChange={(e) => setForm({ ...form, beds: Number(e.target.value) })} required />
          </Field>
        </FormSection>

        <FormSection title="Supplier & Cost">
          <Field label="Supplier">
            <select className="input" value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
              <option value="">— None —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Rate per bed">
            <div className="flex gap-2">
              <input className="input" type="number" min={0} step="0.01" value={form.rate_per_bed || ""} onChange={(e) => setForm({ ...form, rate_per_bed: Number(e.target.value) })} />
              <select className="input w-24" value={form.cost_currency} onChange={(e) => setForm({ ...form, cost_currency: e.target.value })}>
                <option>SAR</option><option>USD</option><option>PKR</option><option>AED</option>
              </select>
            </div>
          </Field>
          <Field label="Remarks" full hint="Note: editing the rate here does not change any bill already posted to Accounts Payable.">
            <input className="input" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
          </Field>
        </FormSection>

        <div className="flex gap-2 border-t border-slate-100 pt-4">
          <button className="btn" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
          <button type="button" className="btn-outline" onClick={() => { if (confirmDiscardIfDirty(dirty)) router.back(); }}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
