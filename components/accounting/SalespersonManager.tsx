"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";
import { useDocRights } from "@/components/AccessProvider";

type SP = { id: string; name: string; phone: string | null; is_active: boolean };
type Rule = { id: string; salesperson_id: string; cost_center: string; method: string; rate: number; is_active: boolean };
type Named = { id: string; name: string };

const METHODS = [
  { v: "percent", label: "% of invoice" },
  { v: "fixed", label: "Fixed / invoice" },
  { v: "per_unit", label: "Per unit" },
];
const methodLabel = (m: string) => METHODS.find((x) => x.v === m)?.label ?? m;
const rateText = (r: Rule) => (r.method === "percent" ? `${Number(r.rate)}%` : Number(r.rate).toLocaleString());

// Salespersons master + their per-cost-center commission rules. A rule drives the
// automatic accrual (Dr Sales Commission / Cr salesperson) when an invoice under
// that cost center is posted for the salesperson.
export default function SalespersonManager({ initialSalespersons, initialRules, costCenters }: {
  initialSalespersons: SP[]; initialRules: Rule[]; costCenters: Named[];
}) {
  const rights = useDocRights("salespersons");
  const router = useRouter();
  const supabase = createClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Draft rule inputs, keyed by salesperson id.
  const [draft, setDraft] = useState<Record<string, { cost_center: string; method: string; rate: string }>>({});
  const rulesBySp = useMemo(() => {
    const m = new Map<string, Rule[]>();
    for (const r of initialRules) { if (!m.has(r.salesperson_id)) m.set(r.salesperson_id, []); m.get(r.salesperson_id)!.push(r); }
    return m;
  }, [initialRules]);

  async function addSalesperson(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    if (!name.trim()) return setErr("Name is required");
    setBusy(true);
    const { error } = await supabase.from("salespersons").insert({ company_id: COMPANY_ID, name: name.trim(), phone: phone.trim() || null });
    setBusy(false);
    if (error) return setErr(error.message);
    setName(""); setPhone(""); router.refresh();
  }
  async function renameSp(s: SP) {
    const v = prompt("Rename salesperson:", s.name); if (v === null || !v.trim()) return;
    await supabase.from("salespersons").update({ name: v.trim() }).eq("id", s.id); router.refresh();
  }
  async function toggleSp(s: SP) {
    await supabase.from("salespersons").update({ is_active: !s.is_active }).eq("id", s.id); router.refresh();
  }
  async function delSp(s: SP) {
    if (!confirm(`Delete ${s.name} and their commission rules? Posted commission entries are kept.`)) return;
    const { error } = await supabase.from("salespersons").delete().eq("id", s.id);
    if (error) return setErr(error.message);
    router.refresh();
  }

  function d(spId: string) { return draft[spId] ?? { cost_center: "", method: "percent", rate: "" }; }
  function setD(spId: string, patch: Partial<{ cost_center: string; method: string; rate: string }>) {
    setDraft((o) => ({ ...o, [spId]: { ...d(spId), ...patch } }));
  }
  async function addRule(spId: string) {
    const r = d(spId); setErr(null);
    if (!r.cost_center) return setErr("Choose a cost center for the rule");
    setBusy(true);
    const { error } = await supabase.from("commission_rules").insert({
      company_id: COMPANY_ID, salesperson_id: spId, cost_center: r.cost_center,
      method: r.method, rate: r.rate === "" ? 0 : Number(r.rate),
    });
    setBusy(false);
    if (error) return setErr(error.message.includes("duplicate") ? "A rule for that cost center already exists — edit it instead." : error.message);
    setDraft((o) => ({ ...o, [spId]: { cost_center: "", method: "percent", rate: "" } })); router.refresh();
  }
  async function editRuleRate(r: Rule) {
    const v = prompt(`Rate for ${r.cost_center} (${methodLabel(r.method)}):`, String(Number(r.rate))); if (v === null) return;
    await supabase.from("commission_rules").update({ rate: Number(v) || 0 }).eq("id", r.id); router.refresh();
  }
  async function delRule(r: Rule) {
    if (!confirm(`Delete the ${r.cost_center} rule?`)) return;
    await supabase.from("commission_rules").delete().eq("id", r.id); router.refresh();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Set a commission rule per cost center for each salesperson. When a Sales Invoice is posted for that
        salesperson under a matching cost center, the commission is credited to them automatically (and debited to
        Sales Commission expense) — no separate entry.
      </p>

      <form onSubmit={addSalesperson} className="card grid grid-cols-1 gap-3 sm:grid-cols-6">
        <div className="sm:col-span-3"><label className="label">Salesperson name *</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="sm:col-span-2"><label className="label">Phone</label>
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <div className="flex items-end sm:col-span-1"><button className="btn w-full disabled:opacity-40" disabled={busy || !rights.canCreate} title={rights.denied("create")}>{busy ? "…" : "+ Add"}</button></div>
        {err && <p className="text-sm text-red-600 sm:col-span-6">{err}</p>}
      </form>

      {initialSalespersons.length === 0 ? (
        <div className="card text-slate-400">No salespersons yet.</div>
      ) : initialSalespersons.map((s) => {
        const rules = rulesBySp.get(s.id) ?? [];
        const dr = d(s.id);
        return (
          <div key={s.id} className="card space-y-3">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-700">{s.name}</span>
              {s.phone && <span className="text-xs text-slate-400">{s.phone}</span>}
              {!s.is_active && <span className="rounded bg-slate-200 px-1.5 text-[10px] uppercase text-slate-500">inactive</span>}
              <span className="ml-auto flex gap-3 text-xs">
                <button onClick={() => renameSp(s)} disabled={!rights.canEdit} title={rights.denied("edit")} className="text-brand hover:underline disabled:opacity-40">Rename</button>
                <button onClick={() => toggleSp(s)} disabled={!rights.canEdit} title={rights.denied("edit")} className="text-slate-500 hover:underline disabled:opacity-40">{s.is_active ? "Disable" : "Enable"}</button>
                <button onClick={() => delSp(s)} disabled={!rights.canDelete} title={rights.denied("delete")} className="text-red-600 hover:underline disabled:opacity-40">Delete</button>
              </span>
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-100">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  <tr><th className="px-2 py-1.5 text-left">Cost Center</th><th className="px-2 py-1.5 text-left">Method</th>
                    <th className="px-2 py-1.5 text-right">Rate</th><th className="w-24" /></tr>
                </thead>
                <tbody>
                  {rules.length === 0 && <tr><td colSpan={4} className="px-2 py-2 text-slate-400">No rules — add one below.</td></tr>}
                  {rules.map((r) => (
                    <tr key={r.id} className="border-t border-slate-100">
                      <td className="px-2 py-1.5 text-slate-700">{r.cost_center}</td>
                      <td className="px-2 py-1.5 text-slate-500">{methodLabel(r.method)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{rateText(r)}</td>
                      <td className="px-2 py-1.5 text-right text-xs">
                        <button onClick={() => editRuleRate(r)} disabled={!rights.canEdit} title={rights.denied("edit")} className="text-brand hover:underline disabled:opacity-40">Rate</button>
                        <button onClick={() => delRule(r)} disabled={!rights.canDelete} title={rights.denied("delete")} className="ml-2 text-red-600 hover:underline disabled:opacity-40">Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-8">
              <select className="input sm:col-span-3" value={dr.cost_center} onChange={(e) => setD(s.id, { cost_center: e.target.value })}>
                <option value="">Cost center…</option>{costCenters.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
              <select className="input sm:col-span-2" value={dr.method} onChange={(e) => setD(s.id, { method: e.target.value })}>
                {METHODS.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}
              </select>
              <input className="input text-right tabular-nums sm:col-span-2" inputMode="decimal" placeholder={dr.method === "percent" ? "%" : "amount"}
                value={dr.rate} onChange={(e) => setD(s.id, { rate: e.target.value })} />
              <button onClick={() => addRule(s.id)} disabled={busy || !rights.canCreate} title={rights.denied("create")} className="btn-outline text-sm disabled:opacity-40 sm:col-span-1">+ Rule</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
