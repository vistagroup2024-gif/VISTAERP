"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { TradeDocCfg } from "@/lib/tradeDocs";

type Row = { product_id: string | null; item_name: string; units: string; quantity: string; rate: string; amount: string; link1: string };
const blankRow = (): Row => ({ product_id: null, item_name: "", units: "", quantity: "", rate: "", amount: "", link1: "" });
const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const num = (s: string) => (s.trim() === "" ? 0 : Number(s) || 0);

export default function TradeVoucher({ cfg }: { cfg: TradeDocCfg }) {
  const router = useRouter();
  const supabase = createClient();

  const [id, setId] = useState<string | null>(null);
  const [docNo, setDocNo] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [party, setParty] = useState("");
  const [costCenter, setCostCenter] = useState("");
  const [tagArea, setTagArea] = useState("");
  const [reference, setReference] = useState("");
  const [mode, setMode] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [terms, setTerms] = useState("");
  const [narration, setNarration] = useState("");
  const [roundOff, setRoundOff] = useState("");
  const [rows, setRows] = useState<Row[]>([blankRow(), blankRow()]);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [parties, setParties] = useState<{ id: string; name: string }[]>([]);
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  const [costCenters, setCostCenters] = useState<{ id: string; name: string }[]>([]);
  const [tagAreas, setTagAreas] = useState<{ id: string; name: string }[]>([]);
  const prodByName = useMemo(() => new Map(products.map((p) => [p.name, p.id])), [products]);

  useEffect(() => {
    (async () => {
      const types = cfg.party === "supplier" ? ["supplier"] : cfg.party === "customer" ? ["customer", "b2b_agent"] : ["customer", "supplier", "b2b_agent"];
      const [{ data: pa }, { data: pr }, { data: cc }, { data: ta }] = await Promise.all([
        supabase.from("parties").select("id, name").in("party_type", types).eq("is_active", true).order("name"),
        supabase.from("acct_products").select("id, name").eq("is_active", true).eq("is_group", false).order("name"),
        supabase.from("acct_cost_centers").select("id, name").eq("is_active", true).eq("is_group", false).order("name"),
        supabase.from("acct_tag_areas").select("id, name").eq("is_active", true).eq("is_group", false).order("name"),
      ]);
      setParties((pa as any[]) ?? []); setProducts((pr as any[]) ?? []);
      setCostCenters((cc as any[]) ?? []); setTagAreas((ta as any[]) ?? []);
    })();
  }, [supabase, cfg.party]);

  function resetNew() {
    setId(null); setDocNo(""); setDone(null); setErr(null);
    setDate(new Date().toISOString().slice(0, 10)); setParty(""); setCostCenter(""); setTagArea("");
    setReference(""); setMode(""); setDueDate(""); setDeliveryDate(""); setTerms(""); setNarration(""); setRoundOff("");
    setRows([blankRow(), blankRow()]);
  }
  function setRow(i: number, patch: Partial<Row>) {
    setRows((rs) => {
      const next = rs.map((r, j) => (j === i ? { ...r, ...patch } : r));
      const r = next[i];
      // amount auto = qty*rate unless the user typed an amount directly
      if (patch.quantity !== undefined || patch.rate !== undefined) r.amount = String(+(num(r.quantity) * num(r.rate)).toFixed(2) || "");
      if (i === next.length - 1 && (patch.item_name || patch.product_id || patch.amount || patch.quantity)) next.push(blankRow());
      return next;
    });
  }
  function pickItem(i: number, name: string) { setRow(i, { item_name: name, product_id: prodByName.get(name) ?? null }); }
  function removeRow(i: number) { setRows((rs) => (rs.length <= 1 ? rs : rs.filter((_, j) => j !== i))); }

  const subtotal = useMemo(() => rows.reduce((s, r) => s + num(r.amount), 0), [rows]);
  const total = subtotal + num(roundOff);

  function fill(v: any) {
    setId(v.id); setDocNo(v.doc_no ?? ""); setDone(null); setErr(null);
    setDate(v.doc_date ?? ""); setParty(v.party_id ?? ""); setCostCenter(v.cost_center ?? ""); setTagArea(v.tag_area ?? "");
    setReference(v.reference ?? ""); setMode(v.mode_of_payment ?? ""); setDueDate(v.due_date ?? ""); setDeliveryDate(v.delivery_date ?? "");
    setTerms(v.terms ?? ""); setNarration(v.narration ?? ""); setRoundOff(v.round_off ? String(v.round_off) : "");
    const ls: Row[] = (v.lines ?? []).map((l: any) => ({
      product_id: l.product_id ?? null, item_name: l.item_name ?? "", units: l.units ?? "",
      quantity: l.quantity ? String(Number(l.quantity)) : "", rate: l.rate ? String(Number(l.rate)) : "",
      amount: l.amount ? String(Number(l.amount)) : "", link1: l.link1 ?? "",
    }));
    setRows(ls.length ? [...ls, blankRow()] : [blankRow(), blankRow()]);
  }
  async function load(pid: string) {
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc("trade_doc_get", { p_id: pid });
    setBusy(false);
    if (error) return setErr(error.message);
    if (!data) return setErr("Document not found.");
    fill(data);
  }
  async function nav(dir: "prev" | "next") {
    setBusy(true);
    const { data, error } = await supabase.rpc("trade_doc_nav", { p_type: cfg.type, p_id: id, p_dir: dir });
    setBusy(false);
    if (error) return setErr(error.message);
    if (!data) return setErr(dir === "prev" ? "This is the first document." : "This is the last document.");
    await load(data as string);
  }
  async function loadByNo() {
    if (!docNo.trim() || docNo.trim() === (id ? docNo : "___")) { /* fallthrough */ }
    setBusy(true);
    const { data, error } = await supabase.rpc("trade_doc_find", { p_type: cfg.type, p_no: docNo.trim() });
    setBusy(false);
    if (error) return setErr(error.message);
    if (!data) return setErr(`No ${cfg.title} with document no. ${docNo.trim()}.`);
    await load(data as string);
  }
  async function del() {
    if (!id) return;
    if (!confirm(`Delete ${cfg.title} ${docNo}? This cannot be undone.`)) return;
    setBusy(true);
    const { error } = await supabase.rpc("trade_doc_delete", { p_id: id });
    setBusy(false);
    if (error) return setErr(error.message);
    setDone(`deleted ${docNo}`); resetNew(); router.refresh();
  }
  function printDoc() { if (id) window.open(`/accounting/trade/${id}`, "_blank"); }

  async function save() {
    setErr(null);
    const header = {
      doc_date: date, party_id: party || null, cost_center: costCenter || null, tag_area: tagArea || null,
      reference: reference || null, mode_of_payment: mode || null, due_date: dueDate || null, delivery_date: deliveryDate || null,
      terms: terms || null, narration: narration || null, round_off: num(roundOff),
    };
    const lines = rows.filter((r) => (r.item_name.trim() || r.product_id) || num(r.amount))
      .map((r) => ({ product_id: r.product_id, item_name: r.item_name.trim() || null, units: r.units || null,
        quantity: num(r.quantity), rate: num(r.rate), amount: num(r.amount), link1: r.link1 || null }));
    if (lines.length === 0) return setErr("Enter at least one item line.");
    setBusy(true);
    const { data, error } = await supabase.rpc("trade_doc_save", { p_type: cfg.type, p_prefix: cfg.prefix, p_id: id, p_header: header, p_lines: lines });
    setBusy(false);
    if (error) return setErr(error.message);
    const r = data as any;
    setId(r.id); setDocNo(r.doc_no); setDone(`saved ${r.doc_no}`); router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{cfg.title}</h1>
        {done && <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-700 capitalize">{done}</span>}
      </div>

      <div className="card flex flex-wrap items-center gap-2 py-2">
        <button onClick={resetNew} disabled={busy} className="btn-outline text-sm">＋ New</button>
        <button onClick={() => nav("prev")} disabled={busy} className="btn-outline text-sm">‹ Previous</button>
        <button onClick={() => nav("next")} disabled={busy} className="btn-outline text-sm">Next ›</button>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={printDoc} disabled={!id} className="btn-outline text-sm disabled:opacity-40">🖨 Print</button>
          <button onClick={del} disabled={!id || busy} className="btn-outline text-sm text-red-600 disabled:opacity-40">🗑 Delete</button>
        </div>
      </div>

      {err && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      <div className="card space-y-4">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div><label className="label">Document No.</label>
            <input className="input font-mono" value={docNo} placeholder="Auto" onChange={(e) => setDocNo(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); loadByNo(); } }} /></div>
          <div><label className="label">Date</label><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          {cfg.party && (
            <div><label className="label">{cfg.party === "supplier" ? "Vendor" : "Customer"}</label>
              <select className="input" value={party} onChange={(e) => setParty(e.target.value)}>
                <option value="">— select —</option>{parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></div>
          )}
          <div><label className="label">Cost Center</label>
            <select className="input" value={costCenter} onChange={(e) => setCostCenter(e.target.value)}>
              <option value="">—</option>{costCenters.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select></div>
          <div><label className="label">Tag Area</label>
            <select className="input" value={tagArea} onChange={(e) => setTagArea(e.target.value)}>
              <option value="">—</option>{tagAreas.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
            </select></div>
          <div><label className="label">Reference</label><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} /></div>
          {cfg.showMode && <div><label className="label">Mode of Payment</label><input className="input" value={mode} onChange={(e) => setMode(e.target.value)} /></div>}
          {cfg.showDue && <div><label className="label">Due Date</label><input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>}
          {cfg.showDelivery && <div><label className="label">Delivery Date</label><input type="date" className="input" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} /></div>}
          {cfg.showTerms && <div className="md:col-span-2"><label className="label">Terms</label><input className="input" value={terms} onChange={(e) => setTerms(e.target.value)} /></div>}
          <div className="md:col-span-2"><label className="label">Narration</label><input className="input" value={narration} onChange={(e) => setNarration(e.target.value)} /></div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <tr><th className="px-2 py-2 text-left">#</th><th className="px-2 py-2 text-left">Item</th>
                <th className="px-2 py-2 text-left">Units</th><th className="px-2 py-2 text-right">{cfg.qtyLabel ?? "Quantity"}</th>
                <th className="px-2 py-2 text-right">Rate</th><th className="px-2 py-2 text-right">Amount</th><th className="w-8" /></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-2 py-1 text-slate-400">{i + 1}</td>
                  <td className="px-2 py-1 min-w-[220px]">
                    <input className="input" list="trade-products" value={r.item_name} onChange={(e) => pickItem(i, e.target.value)} placeholder="Item / product" />
                  </td>
                  <td className="px-2 py-1"><input className="input w-20" value={r.units} onChange={(e) => setRow(i, { units: e.target.value })} /></td>
                  <td className="px-2 py-1"><input className="input w-24 text-right tabular-nums" inputMode="decimal" value={r.quantity} onChange={(e) => setRow(i, { quantity: e.target.value })} /></td>
                  <td className="px-2 py-1"><input className="input w-28 text-right tabular-nums" inputMode="decimal" value={r.rate} onChange={(e) => setRow(i, { rate: e.target.value })} /></td>
                  <td className="px-2 py-1"><input className="input w-32 text-right tabular-nums" inputMode="decimal" value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} /></td>
                  <td className="px-1 text-center"><button onClick={() => removeRow(i)} className="text-slate-300 hover:text-red-500" title="Remove">×</button></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                <td /><td className="px-2 py-2 text-slate-500" colSpan={4}>Subtotal</td>
                <td className="px-2 py-2 text-right tabular-nums">{money(subtotal)}</td><td />
              </tr>
            </tfoot>
          </table>
          <datalist id="trade-products">{products.map((p) => <option key={p.id} value={p.name} />)}</datalist>
        </div>

        <div className="flex flex-wrap items-end justify-end gap-6">
          <div><label className="label">Round Off</label><input className="input w-28 text-right tabular-nums" inputMode="decimal" value={roundOff} onChange={(e) => setRoundOff(e.target.value)} placeholder="0.00" /></div>
          <div className="text-right"><div className="text-xs uppercase tracking-wide text-slate-400">Net Total</div><div className="text-2xl font-bold text-brand">{money(total)}</div></div>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={save} disabled={busy} className="btn">{busy ? "Saving…" : id ? "Save changes" : "Save"}</button>
          <button onClick={() => setRows((r) => [...r, blankRow()])} className="btn-outline text-sm">+ Line</button>
          <span className="ml-auto text-xs text-slate-400">{id ? `Editing ${docNo}` : "New document — number auto-assigned on save."}</span>
        </div>
      </div>
    </div>
  );
}
