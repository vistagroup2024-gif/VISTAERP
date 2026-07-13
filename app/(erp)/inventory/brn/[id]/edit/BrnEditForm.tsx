"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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
    router.push(`/inventory/brn/${brn.id}`);
    router.refresh();
  }

  return (
    <div className="max-w-lg">
      <h1 className="mb-1 text-2xl font-bold">Edit BRN</h1>
      {locked && (
        <div className="mb-4 rounded bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
          This BRN has consumed inventory. Dates, beds, and city can only be changed by a Super Admin.
        </div>
      )}
      <form onSubmit={save} className="card space-y-4">
        {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="label">Company</label>
            <select className="input" value={form.group_company_id} onChange={(e) => setForm({ ...form, group_company_id: e.target.value })} required>
              <option value="">Select company…</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="label">Hotel name</label>
            <input className="input" value={form.hotel_name} onChange={(e) => setForm({ ...form, hotel_name: e.target.value })} required />
          </div>
          <div>
            <label className="label">BRN</label>
            <input className="input font-mono" value={form.brn} onChange={(e) => setForm({ ...form, brn: e.target.value })} required />
          </div>
          <div>
            <label className="label">City</label>
            <select className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })}>
              <option>Makkah</option><option>Madinah</option><option>Jeddah</option><option>Other</option>
            </select>
          </div>
          <div>
            <label className="label">Check-in</label>
            <input className="input" type="date" value={form.check_in} onChange={(e) => setForm({ ...form, check_in: e.target.value })} required />
          </div>
          <div>
            <label className="label">Check-out</label>
            <input className="input" type="date" value={form.check_out} onChange={(e) => setForm({ ...form, check_out: e.target.value })} required />
          </div>
          <div>
            <label className="label">Beds</label>
            <input className="input" type="number" min={1} value={form.beds || ""} onChange={(e) => setForm({ ...form, beds: Number(e.target.value) })} required />
          </div>
          <div>
            <label className="label">Supplier</label>
            <select className="input" value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
              <option value="">— None —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Rate per bed</label>
            <div className="flex gap-2">
              <input className="input" type="number" min={0} step="0.01" value={form.rate_per_bed || ""} onChange={(e) => setForm({ ...form, rate_per_bed: Number(e.target.value) })} />
              <select className="input w-24" value={form.cost_currency} onChange={(e) => setForm({ ...form, cost_currency: e.target.value })}>
                <option>SAR</option><option>USD</option><option>PKR</option><option>AED</option>
              </select>
            </div>
          </div>
          <div className="col-span-2">
            <label className="label">Remarks</label>
            <input className="input" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
          </div>
        </div>
        <p className="text-xs text-slate-400">Note: editing the rate here does not change any bill already posted to Accounts Payable.</p>
        <div className="flex gap-2">
          <button className="btn" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
          <button type="button" className="btn-outline" onClick={() => router.back()}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
