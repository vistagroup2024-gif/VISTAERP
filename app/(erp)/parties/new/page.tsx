"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";

export default function NewPartyPage() {
  const router = useRouter();
  const supabase = createClient();
  const [form, setForm] = useState({
    party_type: "customer",
    name: "",
    code: "",
    phone: "",
    email: "",
    currency: "PKR",
    credit_limit: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const { error } = await supabase.from("parties").insert({
      company_id: COMPANY_ID,
      party_type: form.party_type,
      name: form.name,
      code: form.code || null,
      phone: form.phone || null,
      email: form.email || null,
      currency: form.currency,
      credit_limit: Number(form.credit_limit),
    });
    setSaving(false);
    if (error) return setError(error.message);
    router.push("/parties");
    router.refresh();
  }

  return (
    <div className="max-w-lg">
      <h1 className="mb-6 text-2xl font-bold">New Party</h1>
      <form onSubmit={save} className="card space-y-4">
        {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div>
          <label className="label">Type</label>
          <select className="input" value={form.party_type} onChange={(e) => setForm({ ...form, party_type: e.target.value })}>
            <option value="customer">Customer (B2C)</option>
            <option value="b2b_agent">B2B Agent</option>
            <option value="supplier">Supplier</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Name</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div>
            <label className="label">Code</label>
            <input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </div>
          <div>
            <label className="label">Phone</label>
            <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <label className="label">Currency</label>
            <select className="input" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
              <option>PKR</option><option>SAR</option><option>USD</option><option>AED</option>
            </select>
          </div>
          <div>
            <label className="label">Credit limit</label>
            <input className="input" type="number" value={form.credit_limit} onChange={(e) => setForm({ ...form, credit_limit: Number(e.target.value) })} />
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
          <button type="button" className="btn-outline" onClick={() => router.back()}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
