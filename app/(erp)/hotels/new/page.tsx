"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";

export default function NewHotelPage() {
  const router = useRouter();
  const supabase = createClient();
  const [form, setForm] = useState({
    name: "",
    city: "makkah",
    rating: 5,
    distance_haram_m: "",
    address: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const { error } = await supabase.from("hotels").insert({
      company_id: COMPANY_ID,
      name: form.name,
      city: form.city,
      rating: Number(form.rating),
      distance_haram_m: form.distance_haram_m ? Number(form.distance_haram_m) : null,
      address: form.address || null,
    });
    setSaving(false);
    if (error) return setError(error.message);
    router.push("/hotels");
    router.refresh();
  }

  return (
    <div className="max-w-lg">
      <h1 className="mb-6 text-2xl font-bold">New Hotel</h1>
      <form onSubmit={save} className="card space-y-4">
        {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div>
          <label className="label">Hotel name</label>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">City</label>
            <select className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })}>
              <option value="makkah">Makkah</option>
              <option value="madinah">Madinah</option>
              <option value="jeddah">Jeddah</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="label">Rating (1-7)</label>
            <input className="input" type="number" min={1} max={7} value={form.rating} onChange={(e) => setForm({ ...form, rating: Number(e.target.value) })} />
          </div>
        </div>
        <div>
          <label className="label">Distance to Haram (meters)</label>
          <input className="input" type="number" value={form.distance_haram_m} onChange={(e) => setForm({ ...form, distance_haram_m: e.target.value })} />
        </div>
        <div>
          <label className="label">Address</label>
          <input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </div>
        <div className="flex gap-2">
          <button className="btn" disabled={saving}>{saving ? "Saving…" : "Save hotel"}</button>
          <button type="button" className="btn-outline" onClick={() => router.back()}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
