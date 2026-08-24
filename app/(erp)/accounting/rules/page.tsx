"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";

type Rule = { id?: string; doc_type: string; min_amount: number; approvals_needed: number; active: boolean };
const DOC_TYPES = [
  ["gl_receipt", "Receipt"], ["gl_payment", "Payment"], ["gl_contra", "Contra"], ["gl_journal", "Journal Entry"],
];

export default function RulesPage() {
  const supabase = createClient();
  const [rules, setRules] = useState<Rule[]>([]);
  const [form, setForm] = useState<Rule>({ doc_type: "gl_payment", min_amount: 0, approvals_needed: 1, active: true });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    const { data } = await supabase.from("acct_approval_rules").select("*").order("doc_type");
    setRules((data ?? []) as Rule[]);
  }
  useEffect(() => { load(); }, []); // eslint-disable-line

  async function save(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setErr(null);
    const { error } = await supabase.from("acct_approval_rules").upsert({
      company_id: COMPANY_ID, doc_type: form.doc_type,
      min_amount: Number(form.min_amount) || 0, approvals_needed: Number(form.approvals_needed) || 1, active: form.active,
    }, { onConflict: "company_id,doc_type" });
    setSaving(false);
    if (error) return setErr(error.message);
    load();
  }
  async function remove(id: string) {
    if (!confirm("Delete this rule?")) return;
    await supabase.from("acct_approval_rules").delete().eq("id", id);
    load();
  }

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-bold">Approval Rules</h1>
      <p className="text-sm text-slate-500">A voucher of the given type whose amount is at least the threshold needs the stated number of authorisations before it posts. No rule = posts immediately on save.</p>
      {err && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      <form onSubmit={save} className="card grid grid-cols-2 items-end gap-3 md:grid-cols-5">
        <div><label className="label">Document</label>
          <select className="input" value={form.doc_type} onChange={(e) => setForm({ ...form, doc_type: e.target.value })}>
            {DOC_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select></div>
        <div><label className="label">Min amount (SAR)</label>
          <input className="input text-right tabular-nums" inputMode="decimal" value={form.min_amount} onChange={(e) => setForm({ ...form, min_amount: Number(e.target.value) })} /></div>
        <div><label className="label">Approvals needed</label>
          <input className="input text-right" type="number" min={1} value={form.approvals_needed} onChange={(e) => setForm({ ...form, approvals_needed: Number(e.target.value) })} /></div>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active</label>
        <button className="btn" disabled={saving}>{saving ? "Saving…" : "Save rule"}</button>
      </form>

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <tr><th className="px-3 py-2 text-left">Document</th><th className="px-3 py-2 text-right">Min amount</th><th className="px-3 py-2 text-right">Approvals</th><th className="px-3 py-2 text-center">Active</th><th /></tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{DOC_TYPES.find((d) => d[0] === r.doc_type)?.[1] ?? r.doc_type}</td>
                <td className="px-3 py-2 text-right tabular-nums">{Number(r.min_amount).toLocaleString()}</td>
                <td className="px-3 py-2 text-right">{r.approvals_needed}</td>
                <td className="px-3 py-2 text-center">{r.active ? "✓" : "—"}</td>
                <td className="px-3 py-2 text-right"><button onClick={() => remove(r.id!)} className="text-red-500 hover:underline">Delete</button></td>
              </tr>
            ))}
            {rules.length === 0 && <tr><td className="px-3 py-6 text-center text-slate-400" colSpan={5}>No rules — all vouchers post immediately.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
