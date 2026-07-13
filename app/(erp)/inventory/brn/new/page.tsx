"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";
import { totalNights } from "@/lib/brn";

export default function NewBrnPage() {
  const router = useRouter();
  const supabase = createClient();
  const [form, setForm] = useState({
    hotel_name: "",
    brn: "",
    city: "",
    check_in: "",
    check_out: "",
    beds: 0,
    remarks: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const nights =
    form.check_in && form.check_out && form.check_out > form.check_in
      ? totalNights(form.check_in, form.check_out)
      : 0;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.hotel_name.trim()) return setError("Hotel name is required");
    if (!form.brn.trim()) return setError("Agreement number (BRN) is required");
    if (!form.check_in || !form.check_out) return setError("Check-in and check-out dates are required");
    if (form.check_out <= form.check_in) return setError("Check-out must be after check-in");
    if (Number(form.beds) <= 0) return setError("Beds must be greater than zero");

    setSaving(true);
    setError(null);
    const { error } = await supabase.from("brn_inventory").insert({
      company_id: COMPANY_ID,
      hotel_name: form.hotel_name.trim(),
      brn: form.brn.trim(),
      city: form.city.trim() || null,
      check_in: form.check_in,
      check_out: form.check_out,
      beds: Number(form.beds),
      remarks: form.remarks.trim() || null,
    });
    setSaving(false);
    if (error) return setError(error.message);
    router.push("/inventory/brn");
    router.refresh();
  }

  return (
    <div className="max-w-lg">
      <h1 className="mb-1 text-2xl font-bold">Add BRN Inventory</h1>
      <p className="mb-6 text-sm text-slate-500">
        Register a bulk hotel bed purchase. Beds become available for every night from check-in until the night before check-out.
      </p>
      <form onSubmit={save} className="card space-y-4">
        {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="grid grid-cols-2 gap-4">
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
              <option value="">—</option>
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
            <input className="input" type="date" value={form.check_out}
              onChange={(e) => setForm({ ...form, check_out: e.target.value })} required />
          </div>
          <div>
            <label className="label">Beds purchased</label>
            <input className="input" type="number" min={1} value={form.beds || ""}
              onChange={(e) => setForm({ ...form, beds: Number(e.target.value) })} required />
          </div>
          <div className="flex items-end">
            {nights > 0 && (
              <p className="text-sm text-slate-500">
                = <b>{nights}</b> night(s) × <b>{form.beds || 0}</b> beds ={" "}
                <b>{nights * (Number(form.beds) || 0)}</b> bed-nights
              </p>
            )}
          </div>
          <div className="col-span-2">
            <label className="label">Remarks</label>
            <input className="input" value={form.remarks}
              onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
          </div>
        </div>

        <div className="flex gap-2">
          <button className="btn" disabled={saving}>{saving ? "Saving…" : "Save BRN"}</button>
          <button type="button" className="btn-outline" onClick={() => router.back()}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
