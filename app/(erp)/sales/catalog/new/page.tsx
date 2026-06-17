"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";

export default function NewServicePage() {
  const router = useRouter();
  const supabase = createClient();
  const [form, setForm] = useState({
    code: "", name: "", service_type: "visa",
    default_cost: 0, cost_currency: "SAR",
    list_price: 0, sell_currency: "PKR",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const { error } = await supabase.from("service_catalog").insert({
      company_id: COMPANY_ID,
      code: form.code || null,
      name: form.name,
      service_type: form.service_type,
      default_cost: Number(form.default_cost),
      cost_currency: form.cost_currency,
      list_price: Number(form.list_price),
      sell_currency: form.sell_currency,
    });
    setSaving(false);
    if (error) return setError(error.message);
    router.push("/sales/catalog");
    router.refresh();
  }

  return (
    <div className="max-w-lg">
      <h1 className="mb-6 text-2xl font-bold">New Service</h1>
      <form onSubmit={save} className="card space-y-4">
        {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Code</label>
            <input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="SVC-VISA" />
          </div>
          <div>
            <label className="label">Type</label>
            <select className="input" value={form.service_type} onChange={(e) => setForm({ ...form, service_type: e.target.value })}>
              <option value="visa">Visa</option>
              <option value="transport">Transport</option>
              <option value="hotel">Hotel</option>
              <option value="air_ticket">Air Ticket</option>
              <option value="insurance">Insurance</option>
              <option value="ziyarat">Ziyarat</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
        <div>
          <label className="label">Service name</label>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Default cost</label>
            <div className="flex gap-2">
              <input className="input" type="number" value={form.default_cost} onChange={(e) => setForm({ ...form, default_cost: Number(e.target.value) })} />
              <select className="input w-24" value={form.cost_currency} onChange={(e) => setForm({ ...form, cost_currency: e.target.value })}>
                <option>SAR</option><option>USD</option><option>PKR</option><option>AED</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">List (sell) price</label>
            <div className="flex gap-2">
              <input className="input" type="number" value={form.list_price} onChange={(e) => setForm({ ...form, list_price: Number(e.target.value) })} />
              <select className="input w-24" value={form.sell_currency} onChange={(e) => setForm({ ...form, sell_currency: e.target.value })}>
                <option>PKR</option><option>SAR</option><option>USD</option><option>AED</option>
              </select>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn" disabled={saving}>{saving ? "Saving…" : "Save service"}</button>
          <button type="button" className="btn-outline" onClick={() => router.back()}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
