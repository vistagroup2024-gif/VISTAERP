"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";

type Rule = { id?: string; doc_type: string; min_amount: number; approvals_needed: number; active: boolean };
type Authorizer = { user_id: string; name: string; is_admin: boolean; limit: number | null };
type StaffUser = { id: string; full_name: string | null; email: string | null };
type Approver = { user_id: string; name: string };
const DOC_TYPES = [
  ["gl_receipt", "Receipt"], ["gl_payment", "Payment"], ["gl_contra", "Contra"], ["gl_journal", "Journal Entry"],
];

export default function RulesPage() {
  const supabase = createClient();
  const [rules, setRules] = useState<Rule[]>([]);
  const [form, setForm] = useState<Rule>({ doc_type: "gl_payment", min_amount: 0, approvals_needed: 1, active: true });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [authorizers, setAuthorizers] = useState<Authorizer[]>([]);
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [approvers, setApprovers] = useState<Record<string, Approver[]>>({});
  const [savingWho, setSavingWho] = useState<string | null>(null);
  async function load() {
    const { data } = await supabase.from("acct_approval_rules").select("*").order("doc_type");
    setRules((data ?? []) as Rule[]);
    const { data: az } = await supabase.rpc("acct_list_authorizers");
    setAuthorizers((az as Authorizer[]) ?? []);
    const { data: su } = await supabase.rpc("staff_users_list", { p_id: null });
    setStaff((su as StaffUser[]) ?? []);
    const { data: ap } = await supabase.rpc("voucher_approvers_list");
    setApprovers((ap as Record<string, Approver[]>) ?? {});
  }
  useEffect(() => { load(); }, []); // eslint-disable-line

  async function setLimit(u: Authorizer) {
    const cur = u.limit == null ? "" : String(u.limit);
    const v = prompt(`Authorisation limit for ${u.name} (blank = no limit):`, cur);
    if (v === null) return;
    const lim = v.trim() === "" ? null : Number(v) || 0;
    const { error } = await supabase.rpc("acct_set_authorize_limit", { p_user: u.user_id, p_limit: lim });
    if (error) return setErr(error.message);
    load();
  }

  async function toggleApprover(docType: string, userId: string) {
    const cur = (approvers[docType] ?? []).map((a) => a.user_id);
    const next = cur.includes(userId) ? cur.filter((x) => x !== userId) : [...cur, userId];
    setSavingWho(docType); setErr(null);
    const { error } = await supabase.rpc("voucher_approvers_set", { p_doc_type: docType, p_user_ids: next });
    setSavingWho(null);
    if (error) return setErr(error.message);
    load();
  }

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
      <h1 className="text-xl font-bold tracking-tight text-slate-900">Voucher Authorisation</h1>
      <p className="text-sm text-slate-500">
        Tick who may authorise each voucher type. A type with at least one approver is held when it is
        saved and posts the moment one of them approves it — nobody else can, and a maker can never
        approve their own. A type with nobody ticked posts immediately on save.
      </p>
      {err && <div className="rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{err}</div>}

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">Voucher</th>
              {staff.map((u) => <th key={u.id} className="px-3 py-2 text-center font-medium normal-case">{u.full_name || u.email}</th>)}
              <th className="px-3 py-2 text-left">Effect</th>
            </tr>
          </thead>
          <tbody>
            {DOC_TYPES.map(([k, l]) => {
              const picked = (approvers[k] ?? []).map((a) => a.user_id);
              return (
                <tr key={k} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-700">{l}</td>
                  {staff.map((u) => (
                    <td key={u.id} className="px-3 py-2 text-center">
                      <input type="checkbox" disabled={savingWho === k}
                        checked={picked.includes(u.id)}
                        onChange={() => toggleApprover(k, u.id)} />
                    </td>
                  ))}
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {picked.length === 0
                      ? "Posts immediately"
                      : `Held for ${(approvers[k] ?? []).map((a) => a.name).join(", ")}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2 className="pt-2 text-xl font-bold">Approval Rules</h2>
      <p className="text-sm text-slate-500">Optional extra control. For a voucher type that has NO approver ticked above, a rule still holds it once the amount reaches the threshold. For a type that does have approvers, the rule only raises how many of them must approve.</p>

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

      <div className="card overflow-x-auto p-0">
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

      <h2 className="pt-2 text-xl font-bold">User Authorisation Limits</h2>
      <p className="text-sm text-slate-500">The maximum voucher amount each authoriser may approve. Blank = no limit. Admins (super-admin) bypass all limits. Only an admin can change these.</p>
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <tr><th className="px-3 py-2 text-left">User</th><th className="px-3 py-2 text-right">Limit (SAR)</th><th /></tr>
          </thead>
          <tbody>
            {authorizers.map((u) => (
              <tr key={u.user_id} className="border-t border-slate-100">
                <td className="px-3 py-2">{u.name}{u.is_admin && <span className="ml-2 rounded bg-brand/10 px-1.5 text-[10px] uppercase text-brand">admin</span>}</td>
                <td className="px-3 py-2 text-right tabular-nums">{u.is_admin ? "—" : (u.limit == null ? "No limit" : Number(u.limit).toLocaleString())}</td>
                <td className="px-3 py-2 text-right">{!u.is_admin && <button onClick={() => setLimit(u)} className="text-brand hover:underline">Set limit</button>}</td>
              </tr>
            ))}
            {authorizers.length === 0 && <tr><td className="px-3 py-6 text-center text-slate-400" colSpan={3}>No authorisers, or you are not an admin.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
