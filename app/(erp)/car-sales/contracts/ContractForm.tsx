"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { sar } from "../lib";
import PageHeader from "@/components/PageHeader";
import FormSection, { Field } from "@/components/ui/FormSection";

interface Opt { id: string; name: string }
interface VehicleOpt { id: string; label: string; is_trading?: boolean }
interface Inst { due_date: string; amount: string; notes: string; paid?: number }

function addMonthsISO(iso: string, n: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, d));
  return dt.toISOString().slice(0, 10);
}

export default function ContractForm({ existing, installments = [], customers, vehicles }: {
  existing: any | null; installments?: any[]; customers: Opt[]; vehicles: VehicleOpt[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [h, setH] = useState({
    customer_id: existing?.customer_id ?? "",
    vehicle_id: existing?.vehicle_id ?? "",
    contract_date: existing?.contract_date ?? new Date().toISOString().slice(0, 10),
    delivery_date: existing?.delivery_date ?? "",
    sale_price: existing?.sale_price ?? "",
    advance: existing?.advance ?? "",
    reference_name: existing?.reference_name ?? "",
    salesperson: existing?.salesperson ?? "",
    notes: existing?.notes ?? "",
    // Keep the vehicle registered in Vista's name → monthly service charges apply.
    // Uncheck for a cash/trading sale handed over in the customer's name.
    keep_vista: (existing as any)?.keep_vista ?? true,
  });
  const [rows, setRows] = useState<Inst[]>(installments.length
    ? installments.map((i) => ({ due_date: i.due_date ?? "", amount: String(i.amount ?? ""), notes: i.notes ?? "", paid: Number(i.paid_amount || 0) }))
    : []);
  const [gen, setGen] = useState({ months: "12", start: new Date().toISOString().slice(0, 10) });

  // "Keep in Vista's name" only applies to CAR TRADING vehicles. Installment
  // vehicles are always retained in Vista's name (monthly charges always apply),
  // so the choice is hidden and forced on for them.
  const isTrading = useMemo(() => !!vehicles.find((v) => v.id === h.vehicle_id)?.is_trading, [vehicles, h.vehicle_id]);
  const remaining = useMemo(() => (Number(h.sale_price) || 0) - (Number(h.advance) || 0), [h.sale_price, h.advance]);
  const schedTotal = useMemo(() => rows.reduce((a, r) => a + (Number(r.amount) || 0), 0), [rows]);
  const diff = useMemo(() => Math.round(((Number(h.sale_price) || 0) - (Number(h.advance) || 0) - schedTotal) * 100) / 100, [h.sale_price, h.advance, schedTotal]);

  const setRow = (i: number, k: keyof Inst, v: any) => setRows((a) => a.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));

  function generate() {
    const months = Math.max(1, parseInt(gen.months) || 0);
    const rem = Math.max(0, remaining);
    // largest-remainder distribution into whole SAR
    const base = Math.floor((rem * 100) / months) / 100;
    const amounts = Array(months).fill(base);
    let assigned = base * months;
    let leftover = Math.round((rem - assigned) * 100);
    for (let i = 0; i < months && leftover > 0; i++) { amounts[i] = Math.round((amounts[i] + 0.01) * 100) / 100; leftover--; }
    setRows(amounts.map((amt, i) => ({ due_date: addMonthsISO(gen.start, i), amount: String(amt), notes: "" })));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (diff !== 0) { setErr(`Advance + installments must equal the sale price. Difference: ${sar(diff)}.`); return; }
    setSaving(true); setErr(null);
    // Installment vehicles are always kept in Vista's name; only a trading
    // vehicle can be handed over (keep_vista unchecked).
    const payload = { ...h, keep_vista: isTrading ? h.keep_vista : true, sale_price: String(h.sale_price || 0), advance: String(h.advance || 0) };
    const p_inst = rows.map((r) => ({ due_date: r.due_date, amount: String(r.amount || 0), notes: r.notes }));
    const { data, error } = await supabase.rpc("car_contract_save", { p_id: existing?.id ?? null, p_header: payload, p_installments: p_inst });
    setSaving(false);
    if (error) return setErr(error.message);
    router.push(`/car-sales/contracts/${data}`);
    router.refresh();
  }

  return (
    <div className="max-w-5xl">
      <PageHeader title={existing ? "Edit Contract" : "New Contract"} subtitle="Installment sale contract and payment schedule" />
      <form onSubmit={save} className="space-y-6">
      {err && <div className="rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{err}</div>}

      <div className="card space-y-6">
        <FormSection title="Contract" cols={3}>
          <Field label="Customer" required>
            <select required className="input" value={h.customer_id} onChange={(e) => setH({ ...h, customer_id: e.target.value })}>
              <option value="">— select —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Vehicle" required>
            <select required className="input" value={h.vehicle_id} onChange={(e) => setH({ ...h, vehicle_id: e.target.value })}>
              <option value="">— select —</option>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </Field>
          <Field label="Contract Date"><input type="date" className="input" value={h.contract_date} onChange={(e) => setH({ ...h, contract_date: e.target.value })} /></Field>
          <Field label="Reference / Introducer"><input className="input" value={h.reference_name} onChange={(e) => setH({ ...h, reference_name: e.target.value })} /></Field>
          <Field label="Salesperson"><input className="input" value={h.salesperson} onChange={(e) => setH({ ...h, salesperson: e.target.value })} /></Field>
          <Field label="Delivery Date"><input type="date" className="input" value={h.delivery_date} onChange={(e) => setH({ ...h, delivery_date: e.target.value })} /></Field>
        </FormSection>

        <FormSection title="Financials" cols={3}>
          <Field label="Installment Sale Price (SAR)" required><input type="number" step="0.01" className="input" value={h.sale_price} onChange={(e) => setH({ ...h, sale_price: e.target.value })} /></Field>
          <Field label="Advance (SAR)"><input type="number" step="0.01" className="input" value={h.advance} onChange={(e) => setH({ ...h, advance: e.target.value })} /></Field>
          {isTrading && (
            <Field label="Registration" full>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={h.keep_vista} onChange={(e) => setH({ ...h, keep_vista: e.target.checked })} />
                Keep registered in Vista's name — monthly service charges apply until transferred
              </label>
            </Field>
          )}
          <Field label="Installment Balance (auto)"><input className="input bg-slate-50" value={remaining.toFixed(2)} readOnly tabIndex={-1} /></Field>
          <div className="flex items-end">
            <span className={`text-sm ${diff === 0 ? "text-emerald-700" : "text-red-600"}`}>
              {diff === 0 ? "✓ Schedule balances" : `Difference: ${sar(diff)}`}
            </span>
          </div>
        </FormSection>
      </div>

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-slate-700">Installment Schedule</h2>
          <div className="flex items-end gap-2">
            <div><label className="label">Months</label><input type="number" min={1} className="input w-20" value={gen.months} onChange={(e) => setGen({ ...gen, months: e.target.value })} /></div>
            <div><label className="label">First due</label><input type="date" className="input" value={gen.start} onChange={(e) => setGen({ ...gen, start: e.target.value })} /></div>
            <button type="button" className="btn-outline text-sm" onClick={generate}>Generate monthly</button>
            <button type="button" className="btn-outline text-sm" onClick={() => setRows((a) => [...a, { due_date: "", amount: "", notes: "" }])}>+ Row</button>
          </div>
        </div>
        <p className="text-xs text-slate-400">Amounts can be different every month. Generate creates an even split you can then edit (e.g. make one month larger).</p>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
              <th className="th">No.</th><th className="th">Due Date</th><th className="th text-right">Amount (SAR)</th><th className="th">Notes</th><th className="th"></th>
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-slate-50">
                  <td className="td">{i + 1}</td>
                  <td className="td"><input type="date" className="input" value={r.due_date} disabled={!!r.paid} onChange={(e) => setRow(i, "due_date", e.target.value)} /></td>
                  <td className="td text-right"><input type="number" step="0.01" className="input text-right" value={r.amount} disabled={!!r.paid} onChange={(e) => setRow(i, "amount", e.target.value)} /></td>
                  <td className="td"><input className="input" value={r.notes} onChange={(e) => setRow(i, "notes", e.target.value)} /></td>
                  <td className="td text-right">{!r.paid && <button type="button" className="text-red-500 hover:underline" onClick={() => setRows((a) => a.filter((_, idx) => idx !== i))}>✕</button>}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={5}>No installments yet — generate a schedule or add rows.</td></tr>}
            </tbody>
            <tfoot><tr className="border-t-2 border-slate-200 font-semibold">
              <td className="td" colSpan={2}>Total ({rows.length})</td>
              <td className="td text-right tabular-nums">{sar(schedTotal)}</td>
              <td className="td" colSpan={2}></td>
            </tr></tfoot>
          </table>
        </div>
      </section>

      <div className="flex gap-2 border-t border-slate-100 pt-4">
        <button className="btn" disabled={saving || diff !== 0}>{saving ? "Saving…" : existing ? "Save changes" : "Create contract"}</button>
        <button type="button" className="btn-outline" onClick={() => router.back()}>Cancel</button>
      </div>
      </form>
    </div>
  );
}
