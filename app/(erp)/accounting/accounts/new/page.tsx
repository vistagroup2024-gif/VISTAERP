"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";

export default function NewAccountPage() {
  const router = useRouter();
  const supabase = createClient();
  const [form, setForm] = useState({ code: "", name: "", type: "expense", is_postable: true });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const { error } = await supabase.from("accounts").insert({
      company_id: COMPANY_ID,
      code: form.code,
      name: form.name,
      type: form.type,
      is_postable: form.is_postable,
    });
    setSaving(false);
    if (error) return setError(error.message);
    router.push("/accounting/accounts");
    router.refresh();
  }

  return (
    <div className="max-w-lg">
      <h1 className="mb-6 text-2xl font-bold">New Account</h1>
      <form onSubmit={save} className="card space-y-4">
        {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Code</label>
            <input className="input font-mono" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. 6300" required />
          </div>
          <div>
            <label className="label">Type</label>
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="asset">Asset</option>
              <option value="liability">Liability</option>
              <option value="equity">Equity</option>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
            </select>
          </div>
        </div>
        <div>
          <label className="label">Account name</label>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.is_postable} onChange={(e) => setForm({ ...form, is_postable: e.target.checked })} />
          Postable (can be used on journal lines)
        </label>
        <div className="flex gap-2">
          <button className="btn" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
          <button type="button" className="btn-outline" onClick={() => router.back()}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
