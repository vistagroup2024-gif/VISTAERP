"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/format";
import { totalNights } from "@/lib/brn";
import { useUnsavedChanges, confirmDiscardIfDirty } from "@/lib/useUnsavedChanges";

export default function NewBrnForm({ suppliers, companies }: { suppliers: { id: string; name: string }[]; companies: { id: string; name: string }[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [form, setForm] = useState({
    group_company_id: companies[0]?.id ?? "",
    hotel_name: "",
    brn: "",
    city: "Makkah",
    check_in: "",
    check_out: "",
    beds: 0,
    supplier_id: "",
    rate_per_bed: 0,
    cost_currency: "SAR",
    remarks: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savedRef = useRef(false);
  const initialRef = useRef(JSON.stringify(form));
  const dirty = !savedRef.current && JSON.stringify(form) !== initialRef.current;
  useUnsavedChanges(dirty);

  const nights =
    form.check_in && form.check_out && form.check_out > form.check_in
      ? totalNights(form.check_in, form.check_out) : 0;
  const totalCost = Number(form.beds) * Number(form.rate_per_bed);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.group_company_id) return setError("Company is required");
    if (!form.hotel_name.trim()) return setError("Hotel name is required");
    if (!form.brn.trim()) return setError("Agreement number (BRN) is required");
    if (!form.check_in || !form.check_out) return setError("Check-in and check-out dates are required");
    if (form.check_out <= form.check_in) return setError("Check-out must be after check-in");
    if (Number(form.beds) <= 0) return setError("Beds must be greater than zero");

    setSaving(true);
    setError(null);
    const { error } = await supabase.rpc("add_brn", {
      p_group_company_id: form.group_company_id,
      p_hotel_name: form.hotel_name.trim(),
      p_brn: form.brn.trim(),
      p_city: form.city,
      p_check_in: form.check_in,
      p_check_out: form.check_out,
      p_beds: Number(form.beds),
      p_supplier_id: form.supplier_id || null,
      p_rate_per_bed: Number(form.rate_per_bed) || 0,
      p_cost_currency: form.cost_currency,
      p_remarks: form.remarks.trim() || null,
    });
    setSaving(false);
    if (error) return setError(error.message);
    savedRef.current = true;
    router.push("/inventory/brn");
    router.refresh();
  }

  return (
    <div className="max-w-lg">
      <h1 className="mb-1 text-2xl font-bold">Add BRN Inventory</h1>
      <p className="mb-6 text-sm text-slate-500">
        Register a bulk hotel bed purchase. Beds are available every night from check-in until the night before check-out.
      </p>
      <form onSubmit={save} className="space-y-5">
        {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="card space-y-4">
          <h2 className="font-semibold text-slate-700">Agreement</h2>
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
              <input className="input" value={form.hotel_name} placeholder="e.g. Frontel Al Harithia"
                onChange={(e) => setForm({ ...form, hotel_name: e.target.value })} required />
            </div>
            <div>
              <label className="label">Agreement number (BRN)</label>
              <input className="input font-mono" value={form.brn} placeholder="BRN-100245"
                onChange={(e) => setForm({ ...form, brn: e.target.value })} required />
            </div>
            <div>
              <label className="label">City</label>
              <select className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })}>
                <option>Makkah</option>
                <option>Madinah</option>
                <option>Jeddah</option>
                <option>Other</option>
              </select>
            </div>
            <div>
              <label className="label">Check-in date</label>
              <input className="input" type="date" value={form.check_in}
                onChange={(e) => setForm({ ...form, check_in: e.target.value })} required />
            </div>
            <div>
              <label className="label">Check-out date</label>
              <input className="input" type="date" value={form.check_out} min={form.check_in || undefined}
                onChange={(e) => setForm({ ...form, check_out: e.target.value })} required />
            </div>
            <div>
              <label className="label">Beds purchased</label>
              <input className="input" type="number" min={1} value={form.beds || ""}
                onChange={(e) => setForm({ ...form, beds: Number(e.target.value) })} required />
            </div>
            <div className="flex items-end text-sm text-slate-500">
              {nights > 0 && <span>{nights} night(s) coverage</span>}
            </div>
          </div>
        </div>

        <div className="card space-y-4">
          <h2 className="font-semibold text-slate-700">Supplier & Cost</h2>
          <p className="text-xs text-slate-400">If a supplier and rate are set, a payable (bill) is created automatically in Accounts Payable.</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">Supplier</label>
              <select className="input" value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
                <option value="">— None —</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Rate per bed</label>
              <div className="flex gap-2">
                <input className="input" type="number" min={0} step="0.01" value={form.rate_per_bed || ""}
                  onChange={(e) => setForm({ ...form, rate_per_bed: Number(e.target.value) })} />
                <select className="input w-24" value={form.cost_currency} onChange={(e) => setForm({ ...form, cost_currency: e.target.value })}>
                  <option>SAR</option><option>USD</option><option>PKR</option><option>AED</option>
                </select>
              </div>
            </div>
            <div className="flex items-end">
              <div className="w-full rounded-lg bg-brand/5 px-4 py-2 text-sm">
                Total agreement cost:{" "}
                <b>{money(totalCost, form.cost_currency)}</b>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <label className="label">Remarks</label>
          <input className="input" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
        </div>

        <div className="flex gap-2">
          <button className="btn" disabled={saving}>{saving ? "Saving…" : "Save BRN"}</button>
          <button type="button" className="btn-outline" onClick={() => { if (confirmDiscardIfDirty(dirty)) router.back(); }}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
