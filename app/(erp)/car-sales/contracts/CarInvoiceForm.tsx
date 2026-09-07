"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { sar } from "../lib";
import FormSection, { Field } from "@/components/ui/FormSection";
import LoadFromPicker from "@/components/accounting/LoadFromPicker";
import { useDocRights } from "@/components/AccessProvider";

interface Opt { id: string; name: string }
interface VehicleOpt { id: string; label: string; is_trading?: boolean }
interface Inst { due_date: string; amount: string; notes: string; paid?: number }

function addMonthsISO(iso: string, n: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, d));
  return dt.toISOString().slice(0, 10);
}
const today = () => new Date().toISOString().slice(0, 10);

const blank = () => ({
  customer_id: "", vehicle_id: "", contract_date: today(),
  cost_center: "", tag_area: "", sale_price: "", advance: "", advance_due_date: "",
  reference_name: "", salesperson: "", notes: "", keep_vista: true,
});

/**
 * The Car Invoice, opened the way every other voucher is: it IS the screen
 * rather than a list you click through to. New / Previous / Next and the
 * invoice number move between them, and Load Sale Order fills the rest.
 */
export default function CarInvoiceForm({ existing, installments = [], customers, vehicles, costCenters, tagAreas }: {
  existing?: any | null; installments?: any[]; customers: Opt[]; vehicles: VehicleOpt[];
  costCenters: Opt[]; tagAreas: Opt[];
}) {
  const rights = useDocRights("car_invoice");
  const router = useRouter();
  const supabase = createClient();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [id, setId] = useState<string | null>(existing?.id ?? null);
  const [docNo, setDocNo] = useState<string>(existing?.contract_no ?? "");
  const [status, setStatus] = useState<string>(existing?.status ?? "draft");
  const [h, setH] = useState(() => existing ? {
    customer_id: existing.customer_id ?? "", vehicle_id: existing.vehicle_id ?? "",
    contract_date: existing.contract_date ?? today(),
    cost_center: existing.cost_center ?? "", tag_area: existing.tag_area ?? "",
    sale_price: existing.sale_price ?? "", advance: existing.advance ?? "",
    advance_due_date: existing.advance_due_date ?? "",
    reference_name: existing.reference_name ?? "", salesperson: existing.salesperson ?? "",
    notes: existing.notes ?? "", keep_vista: existing.keep_vista ?? true,
  } : blank());
  const [rows, setRows] = useState<Inst[]>(installments.length
    ? installments.map((i) => ({ due_date: i.due_date ?? "", amount: String(i.amount ?? ""), notes: i.notes ?? "", paid: Number(i.paid_amount || 0) }))
    : []);
  const [gen, setGen] = useState({ months: "12", start: today() });
  const [sourceId, setSourceId] = useState<string | null>(existing?.source_doc_id ?? null);
  const [sourceNo, setSourceNo] = useState<string | null>(null);
  const [loadOpen, setLoadOpen] = useState(false);
  // The item the Sale Order named. The vehicle IS that item, so when the yard
  // has one against it the picker is already filled — this says which it is.
  const [itemName, setItemName] = useState<string | null>(null);

  const finalised = !!id && status !== "draft";

  /** Read one invoice back into the form — used by Previous / Next and by
   *  typing an invoice number. */
  const openInvoice = useCallback(async (row: any) => {
    const { data: inst } = await supabase.from("car_installments")
      .select("due_date, amount, notes, paid_amount").eq("contract_id", row.id).order("inst_no");
    setId(row.id); setDocNo(row.contract_no); setStatus(row.status ?? "draft");
    setH({
      customer_id: row.customer_id ?? "", vehicle_id: row.vehicle_id ?? "",
      contract_date: row.contract_date ?? today(),
      cost_center: row.cost_center ?? "", tag_area: row.tag_area ?? "",
      sale_price: row.sale_price ?? "", advance: row.advance ?? "",
      advance_due_date: row.advance_due_date ?? "",
      reference_name: row.reference_name ?? "", salesperson: row.salesperson ?? "",
      notes: row.notes ?? "", keep_vista: true,
    });
    setRows((inst ?? []).map((i: any) => ({
      due_date: i.due_date ?? "", amount: String(i.amount ?? ""), notes: i.notes ?? "", paid: Number(i.paid_amount || 0),
    })));
    setSourceId(row.source_doc_id ?? null); setSourceNo(null); setItemName(null);
    setErr(null); setDone(null);
  }, [supabase]);

  const SELECT = "id, contract_no, contract_date, customer_id, vehicle_id, cost_center, tag_area, sale_price, advance, advance_due_date, reference_name, salesperson, notes, status, source_doc_id";

  async function nav(dir: "prev" | "next") {
    setErr(null);
    let q = supabase.from("car_contracts").select(SELECT).limit(1);
    // "Previous" is the one before this in invoice-number order, which is the
    // order they were raised in.
    q = docNo
      ? (dir === "prev" ? q.lt("contract_no", docNo).order("contract_no", { ascending: false })
                        : q.gt("contract_no", docNo).order("contract_no"))
      : q.order("contract_no", { ascending: dir === "next" });
    const { data, error } = await q;
    if (error) return setErr(error.message);
    if (!data?.length) return setErr(dir === "prev" ? "This is the first car invoice." : "This is the last car invoice.");
    openInvoice(data[0]);
  }

  async function loadByNo() {
    if (!docNo.trim()) return;
    const { data, error } = await supabase.from("car_contracts").select(SELECT).eq("contract_no", docNo.trim()).maybeSingle();
    if (error) return setErr(error.message);
    if (!data) return setErr(`No car invoice numbered ${docNo.trim()}.`);
    openInvoice(data);
  }

  function resetNew() {
    setId(null); setDocNo(""); setStatus("draft"); setH(blank()); setRows([]);
    setSourceId(null); setSourceNo(null); setItemName(null); setErr(null); setDone(null);
  }

  /**
   * Load a car Sale Order. Everything the order knows comes across — customer,
   * cost centre, tag area, the agreed price, the advance and when it falls due,
   * the reference and the note — and the VEHICLE with it: the order's line names
   * the item, and the car in the yard against that item is the one being sold.
   * Only if the yard has nothing free against it is the picker left to the
   * operator. The instalment months come across too, so Generate is ready.
   */
  async function loadFromOrder(pid: string) {
    setLoadOpen(false); setErr(null);
    const { data, error } = await supabase.rpc("car_invoice_from_sale_order", { p_doc: pid });
    if (error) return setErr(error.message);
    const v = data as any;
    if (!v) return setErr("Sale Order not found.");
    setH((cur) => ({
      ...cur,
      customer_id: v.customer_id ?? cur.customer_id,
      vehicle_id: v.vehicle_id ?? cur.vehicle_id,
      cost_center: v.cost_center ?? cur.cost_center,
      tag_area: v.tag_area ?? cur.tag_area,
      sale_price: String(v.sale_price ?? cur.sale_price ?? ""),
      advance: String(v.advance ?? cur.advance ?? ""),
      advance_due_date: v.advance_due_date ?? cur.advance_due_date,
      reference_name: v.reference_name ?? cur.reference_name,
      notes: v.notes ?? cur.notes,
    }));
    if (Number(v.installment_months) > 0) setGen((g) => ({ ...g, months: String(v.installment_months) }));
    setRows([]);
    setItemName(v.item_name ?? null);
    setSourceId(v.id); setSourceNo(v.doc_no ?? null);
    setDone(`loaded from ${v.doc_no}`);
    if (!v.vehicle_id && v.item_name) {
      setErr(`No car is free in stock for "${v.item_name}" — choose the vehicle by hand.`);
    }
  }

  async function del() {
    if (!id) return;
    if (!confirm(`Delete car invoice ${docNo}? This cannot be undone.`)) return;
    setSaving(true); setErr(null);
    const { error } = await supabase.rpc("car_contract_delete", { p_id: id });
    setSaving(false);
    if (error) return setErr(error.message);
    resetNew(); router.refresh();
  }

  const isTrading = useMemo(() => !!vehicles.find((v) => v.id === h.vehicle_id)?.is_trading, [vehicles, h.vehicle_id]);
  const remaining = useMemo(() => (Number(h.sale_price) || 0) - (Number(h.advance) || 0), [h.sale_price, h.advance]);
  const schedTotal = useMemo(() => rows.reduce((a, r) => a + (Number(r.amount) || 0), 0), [rows]);
  const diff = useMemo(() => Math.round(((Number(h.sale_price) || 0) - (Number(h.advance) || 0) - schedTotal) * 100) / 100, [h.sale_price, h.advance, schedTotal]);

  const setRow = (i: number, k: keyof Inst, v: any) => setRows((a) => a.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));

  function generate() {
    const months = Math.max(1, parseInt(gen.months) || 0);
    const rem = Math.max(0, remaining);
    const base = Math.floor((rem * 100) / months) / 100;
    const amounts = Array(months).fill(base);
    const assigned = base * months;
    let leftover = Math.round((rem - assigned) * 100);
    for (let i = 0; i < months && leftover > 0; i++) { amounts[i] = Math.round((amounts[i] + 0.01) * 100) / 100; leftover--; }
    setRows(amounts.map((amt, i) => ({ due_date: addMonthsISO(gen.start, i), amount: String(amt), notes: "" })));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (diff !== 0) { setErr(`Advance + installments must equal the sale price. Difference: ${sar(diff)}.`); return; }
    setSaving(true); setErr(null);
    const payload = { ...h, keep_vista: isTrading ? h.keep_vista : true, sale_price: String(h.sale_price || 0), advance: String(h.advance || 0) };
    const p_inst = rows.map((r) => ({ due_date: r.due_date, amount: String(r.amount || 0), notes: r.notes }));
    const { data, error } = await supabase.rpc("car_contract_save", { p_id: id, p_header: payload, p_installments: p_inst });
    if (error) { setSaving(false); return setErr(error.message); }
    if (sourceId) {
      const { error: le } = await supabase.rpc("car_contract_link_source", { p_contract: data, p_doc: sourceId });
      if (le) { setSaving(false); return setErr(le.message); }
    }
    const { data: row } = await supabase.from("car_contracts").select(SELECT).eq("id", data).maybeSingle();
    setSaving(false);
    if (row) { await openInvoice(row); setDone(`saved ${row.contract_no}`); }
    router.refresh();
  }

  const mayEdit = id ? rights.canEdit : rights.canCreate;

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Car Invoice</h1>
        <span className="rounded-full bg-brand/10 px-3 py-1 text-xs font-medium uppercase tracking-wide text-brand">car sales</span>
        {done && <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-700">{done}</span>}
      </div>

      <div className="card flex flex-wrap items-center gap-2 py-2">
        <button type="button" onClick={resetNew} disabled={saving} className="btn-outline text-sm">＋ New</button>
        <button type="button" onClick={() => nav("prev")} disabled={saving} className="btn-outline text-sm">‹ Previous</button>
        <button type="button" onClick={() => nav("next")} disabled={saving} className="btn-outline text-sm">Next ›</button>
        <button type="button" onClick={() => setLoadOpen(true)} disabled={saving || finalised} className="btn text-sm disabled:opacity-40">⤓ Load Sale Order</button>
        {sourceNo && <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">from {sourceNo}</span>}
        <div className="ml-auto flex items-center gap-2">
          {finalised && <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium uppercase text-green-700">{status}</span>}
          <button type="button" onClick={() => id && router.push(`/car-sales/contracts/${id}`)} disabled={!id}
            className="btn-outline text-sm disabled:opacity-40">Open ↗</button>
          <button type="button" onClick={() => id && window.open(`/car-sales/contracts/${id}/agreement`, "_blank")}
            disabled={!id || !rights.canPrint} title={rights.denied("print")} className="btn-outline text-sm disabled:opacity-40">🖨 Print</button>
          <button type="button" onClick={del} disabled={!id || saving || !rights.canDelete} title={rights.denied("delete")}
            className="btn-outline text-sm text-red-600 disabled:opacity-40">🗑 Delete</button>
        </div>
      </div>

      {loadOpen && (
        <LoadFromPicker targetType="car_invoice" sourceTitle="Sale Order" rpc="car_pending_sale_orders" rpcArgs={{}}
          onPick={loadFromOrder} onClose={() => setLoadOpen(false)} />
      )}

      {err && <div className="rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{err}</div>}

      <form onSubmit={save} className="space-y-6">
        <div className="card space-y-6">
          <FormSection title="Car Invoice" cols={3}>
            <Field label="Invoice No.">
              <input className="input font-mono" value={docNo} placeholder="Auto"
                onChange={(e) => setDocNo(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); loadByNo(); } }} />
            </Field>
            <Field label="Date">
              <input type="date" className="input" value={h.contract_date} onChange={(e) => setH({ ...h, contract_date: e.target.value })} />
            </Field>
            <Field label="Customer" required>
              <select required className="input" value={h.customer_id} onChange={(e) => setH({ ...h, customer_id: e.target.value })}>
                <option value="">— select —</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Cost Center">
              <select className="input" value={h.cost_center} onChange={(e) => setH({ ...h, cost_center: e.target.value })}>
                <option value="">—</option>
                {costCenters.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Tag Area">
              <select className="input" value={h.tag_area} onChange={(e) => setH({ ...h, tag_area: e.target.value })}>
                <option value="">—</option>
                {tagAreas.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Vehicle (item)" required
              hint={itemName ? `Sale Order item: ${itemName}` : undefined}>
              <select required className="input" value={h.vehicle_id} onChange={(e) => setH({ ...h, vehicle_id: e.target.value })}>
                <option value="">— select —</option>
                {vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            </Field>
            <Field label="Reference / Introducer"><input className="input" value={h.reference_name} onChange={(e) => setH({ ...h, reference_name: e.target.value })} /></Field>
            <Field label="Salesperson"><input className="input" value={h.salesperson} onChange={(e) => setH({ ...h, salesperson: e.target.value })} /></Field>
          </FormSection>

          <FormSection title="Financials" cols={3}>
            <Field label="Installment Sale Price (SAR)" required><input type="number" step="0.01" className="input" value={h.sale_price} onChange={(e) => setH({ ...h, sale_price: e.target.value })} /></Field>
            <Field label="Advance (SAR)"><input type="number" step="0.01" className="input" value={h.advance} onChange={(e) => setH({ ...h, advance: e.target.value })} /></Field>
            <Field label="Advance Due Date"><input type="date" className="input" value={h.advance_due_date} onChange={(e) => setH({ ...h, advance_due_date: e.target.value })} /></Field>
            {isTrading && (
              <Field label="Registration" full>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={h.keep_vista} onChange={(e) => setH({ ...h, keep_vista: e.target.checked })} />
                  Keep registered in Vista&apos;s name — monthly service charges apply until transferred
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
          <button className="btn disabled:opacity-40" disabled={saving || diff !== 0 || finalised || !mayEdit}
            title={finalised ? "This car invoice is finalised — use adjustments to change it" : rights.denied(id ? "edit" : "create")}>
            {!mayEdit ? (id ? "No Edit rights" : "No Create rights") : saving ? "Saving…" : id ? "Save changes" : "Save car invoice"}
          </button>
          <button type="button" className="btn-outline" onClick={resetNew}>Clear</button>
        </div>
      </form>
    </div>
  );
}
