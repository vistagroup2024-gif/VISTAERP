"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";

type Company = { id: string; name: string; supplier_account_id: string | null };
type Acct = { id: string; name: string; code: string };

// Group companies (Visa provider companies). Each can carry its supplier ledger
// so the Visa invoice posts its cost to that account — no separate mapping screen.
export default function CompaniesManager({ companies, supplierAccounts }: {
  companies: Company[]; supplierAccounts: Acct[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [name, setName] = useState("");
  const [supplier, setSupplier] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.from("group_companies")
      .insert({ company_id: COMPANY_ID, name: name.trim(), supplier_account_id: supplier || null });
    setBusy(false);
    if (error) return setErr(error.message);
    setName(""); setSupplier(""); router.refresh();
  }
  async function setSup(c: Company, acctId: string) {
    setErr(null);
    const { error } = await supabase.from("group_companies").update({ supplier_account_id: acctId || null }).eq("id", c.id);
    if (error) return setErr(error.message);
    router.refresh();
  }
  async function del(c: Company) {
    if (!confirm(`Delete company "${c.name}"?`)) return;
    const { error } = await supabase.rpc("delete_group_company", { p_id: c.id });
    if (error) return setErr(error.message);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <form onSubmit={add} className="card flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[180px]">
          <label className="label">Company name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Basma" required />
        </div>
        <div className="min-w-[200px]">
          <label className="label">Supplier ledger (optional)</label>
          <select className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            <option value="">— none —</option>
            {supplierAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <button className="btn" disabled={busy}>{busy ? "Adding…" : "+ Add company"}</button>
        {err && <p className="w-full text-sm text-red-600">{err}</p>}
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <tr><th className="px-3 py-2 text-left">Company</th><th className="px-3 py-2 text-left">Supplier Ledger</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium text-slate-700">{c.name}</td>
                <td className="px-3 py-2">
                  <select className="input max-w-xs" value={c.supplier_account_id ?? ""} onChange={(e) => setSup(c, e.target.value)}>
                    <option value="">— none —</option>
                    {supplierAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => del(c)} className="text-xs text-red-600 hover:underline">Delete</button>
                </td>
              </tr>
            ))}
            {companies.length === 0 && <tr><td className="td text-slate-400" colSpan={3}>No companies yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
