"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isCarCostCenter, type HeaderExtra, type LineExtra, type TradeDocCfg } from "@/lib/tradeDocs";

type Row = {
  product_id: string | null; item_name: string; units: string; quantity: string; rate: string; amount: string;
  link1: string; extras: Record<string, string>;
};
const blankRow = (): Row => ({ product_id: null, item_name: "", units: "", quantity: "", rate: "", amount: "", link1: "", extras: {} });
const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const num = (s: string) => (s?.trim?.() === "" || s == null ? 0 : Number(s) || 0);
const r2 = (n: number) => String(+n.toFixed(2));

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
  // Header extras (incl. the car costing block) live in the document meta.
  const [extras, setExtras] = useState<Record<string, string>>({});
  // Which derived boxes the user has typed into — those stop auto-calculating.
  const [overridden, setOverridden] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [parties, setParties] = useState<{ id: string; name: string }[]>([]);
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  const [costCenters, setCostCenters] = useState<{ id: string; name: string }[]>([]);
  const [tagAreas, setTagAreas] = useState<{ id: string; name: string }[]>([]);
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]);
  const [accounts, setAccounts] = useState<{ id: string; code: string; name: string }[]>([]);
  const [warehouse, setWarehouse] = useState("");
  const [posted, setPosted] = useState(false);
  const prodByName = useMemo(() => new Map(products.map((p) => [p.name, p.id])), [products]);
  // These trade documents post to the GL (+ stock); the rest are paperwork only.
  const canPost = ["purchase_voucher", "purchase_return", "sales_return"].includes(cfg.type);

  // Car-sales cost centres (CAR SALES INSTALLMENT / CAR TRADING) reveal the
  // costing block and the vehicle expense columns.
  const isCar = isCarCostCenter(costCenter);
  const headerExtras: HeaderExtra[] = useMemo(
    () => [...(cfg.headerExtras ?? []), ...(isCar ? cfg.carHeaderExtras ?? [] : [])],
    [cfg, isCar]);
  const lineExtras: LineExtra[] = useMemo(
    () => (isCar && cfg.carLineExtras ? cfg.carLineExtras : cfg.lineExtras ?? []),
    [cfg, isCar]);
  const showRateAmount = !cfg.hideRateAmount;

  useEffect(() => {
    (async () => {
      const types = cfg.party === "supplier" ? ["supplier"] : cfg.party === "customer" ? ["customer", "b2b_agent"] : ["customer", "supplier", "b2b_agent"];
      const [{ data: pa }, { data: pr }, { data: cc }, { data: ta }, { data: wh }, { data: ac }] = await Promise.all([
        supabase.from("parties").select("id, name").in("party_type", types).eq("is_active", true).order("name"),
        supabase.from("acct_products").select("id, name").eq("is_active", true).eq("is_group", false).order("name"),
        supabase.from("acct_cost_centers").select("id, name").eq("is_active", true).eq("is_group", false).order("name"),
        supabase.from("acct_tag_areas").select("id, name").eq("is_active", true).eq("is_group", false).order("name"),
        supabase.from("warehouses").select("id, name").eq("is_active", true).order("name"),
        supabase.from("accounts").select("id, code, name").eq("is_postable", true).eq("is_group", false).order("code"),
      ]);
      setParties((pa as any[]) ?? []); setProducts((pr as any[]) ?? []);
      setCostCenters((cc as any[]) ?? []); setTagAreas((ta as any[]) ?? []);
      setWarehouses((wh as any[]) ?? []); setAccounts((ac as any[]) ?? []);
    })();
  }, [supabase, cfg.party]);

  function resetNew() {
    setId(null); setDocNo(""); setDone(null); setErr(null);
    setDate(new Date().toISOString().slice(0, 10)); setParty(""); setCostCenter(""); setTagArea("");
    setReference(""); setMode(""); setDueDate(""); setDeliveryDate(""); setTerms(""); setNarration(""); setRoundOff("");
    setRows([blankRow(), blankRow()]); setWarehouse(""); setPosted(false); setExtras({}); setOverridden({});
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
  function setRowExtra(i: number, key: string, value: string) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, extras: { ...r.extras, [key]: value } } : r)));
  }
  function pickItem(i: number, name: string) { setRow(i, { item_name: name, product_id: prodByName.get(name) ?? null }); }
  function removeRow(i: number) { setRows((rs) => (rs.length <= 1 ? rs : rs.filter((_, j) => j !== i))); }

  // Derived header values recompute from what is typed, in declaration order, so
  // later formulas (Margin, Selling Price) see the earlier ones (Total Cost,
  // Investment). A box the user edited keeps their number.
  const extraValues = useMemo(() => {
    const v: Record<string, string> = { ...extras };
    for (const f of headerExtras) {
      if (!f.derived || overridden[f.key]) continue;
      v[f.key] = r2(f.derived(v));
    }
    return v;
  }, [extras, headerExtras, overridden]);

  function setExtra(f: HeaderExtra, value: string) {
    setExtras((e) => ({ ...e, [f.key]: value }));
    if (f.derived) setOverridden((o) => ({ ...o, [f.key]: value.trim() !== "" }));
  }

  const subtotal = useMemo(() => rows.reduce((s, r) => s + num(r.amount), 0), [rows]);
  const total = subtotal + num(roundOff);
  // Landed cost = the line amounts plus every expense column flagged as a cost.
  const costColumns = useMemo(() => lineExtras.filter((x) => x.cost), [lineExtras]);
  const landedCost = useMemo(
    () => rows.reduce((s, r) => s + num(r.amount) + costColumns.reduce((c, x) => c + num(r.extras[x.key]), 0), 0),
    [rows, costColumns]);
  const extraCosts = landedCost - subtotal;

  function fill(v: any) {
    setId(v.id); setDocNo(v.doc_no ?? ""); setDone(null); setErr(null);
    setDate(v.doc_date ?? ""); setParty(v.party_id ?? ""); setCostCenter(v.cost_center ?? ""); setTagArea(v.tag_area ?? "");
    setReference(v.reference ?? ""); setMode(v.mode_of_payment ?? ""); setDueDate(v.due_date ?? ""); setDeliveryDate(v.delivery_date ?? "");
    setTerms(v.terms ?? ""); setNarration(v.narration ?? ""); setRoundOff(v.round_off ? String(v.round_off) : "");
    setWarehouse(v.warehouse_id ?? ""); setPosted(!!v.gl_entry);
    const meta = (v.meta ?? {}) as Record<string, any>;
    const saved: Record<string, string> = {};
    for (const [k, val] of Object.entries(meta)) saved[k] = val == null ? "" : String(val);
    setExtras(saved);
    // Saved numbers are authoritative — don't let a formula overwrite them.
    setOverridden(Object.fromEntries(Object.keys(saved).filter((k) => saved[k] !== "").map((k) => [k, true])));
    const ls: Row[] = (v.lines ?? []).map((l: any) => {
      const lm = (l.meta ?? {}) as Record<string, any>;
      const ex: Record<string, string> = {};
      for (const [k, val] of Object.entries(lm)) ex[k] = val == null ? "" : String(val);
      return {
        product_id: l.product_id ?? null, item_name: l.item_name ?? "", units: l.units ?? "",
        quantity: l.quantity ? String(Number(l.quantity)) : "", rate: l.rate ? String(Number(l.rate)) : "",
        amount: l.amount ? String(Number(l.amount)) : "", link1: l.link1 ?? "", extras: ex,
      };
    });
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
    // Only persist the extras this voucher/cost-centre actually shows, so
    // switching cost centre doesn't leave stale car fields on the document.
    const meta: Record<string, any> = {};
    for (const f of headerExtras) {
      const val = (extraValues[f.key] ?? "").trim();
      if (f.kind === "check") { if (val === "true") meta[f.key] = true; else meta[f.key] = false; continue; }
      if (val !== "") meta[f.key] = val;
    }
    const header = {
      doc_date: date, party_id: party || null, cost_center: costCenter || null,
      tag_area: cfg.showTagArea === false ? null : tagArea || null,
      reference: reference || null, mode_of_payment: mode || null, due_date: dueDate || null, delivery_date: deliveryDate || null,
      terms: terms || null, narration: narration || null, round_off: num(roundOff), meta,
    };
    const lines = rows.filter((r) => (r.item_name.trim() || r.product_id) || num(r.amount))
      .map((r) => {
        const lm: Record<string, any> = {};
        if (cfg.tagAreaInLine && r.extras.tag_area) lm.tag_area = r.extras.tag_area;
        for (const x of lineExtras) {
          const val = (r.extras[x.key] ?? "").trim();
          if (val !== "") lm[x.key] = x.kind === "text" ? val : num(val);
        }
        return {
          product_id: r.product_id, item_name: r.item_name.trim() || null, units: r.units || null,
          quantity: num(r.quantity), rate: num(r.rate), amount: num(r.amount), link1: r.link1 || null, meta: lm,
        };
      });
    if (lines.length === 0) return setErr("Enter at least one item line.");
    setBusy(true);
    const { data, error } = await supabase.rpc("trade_doc_save", { p_type: cfg.type, p_prefix: cfg.prefix, p_id: id, p_header: header, p_lines: lines });
    if (error) { setBusy(false); return setErr(error.message); }
    const r = data as any;
    if (canPost && cfg.showWarehouse) await supabase.from("trade_documents").update({ warehouse_id: warehouse || null }).eq("id", r.id);
    setBusy(false);
    setId(r.id); setDocNo(r.doc_no); setDone(`saved ${r.doc_no}`); router.refresh();
  }

  async function post() {
    if (!id) return setErr("Save the document first.");
    if (!confirm(`Post ${cfg.title} ${docNo} to the accounts? This books the GL${extraValues.update_stock === "true" ? " and stock" : ""}.`)) return;
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc("trade_doc_post", { p_id: id });
    setBusy(false);
    if (error) return setErr(error.message);
    setPosted(true); setDone(`posted to GL (${(data as any)?.entry_no ?? ""})`); router.refresh();
  }

  const gridCols = 3 + (showRateAmount ? 3 : 1) + (cfg.tagAreaInLine ? 1 : 0) + lineExtras.length;

  function headerField(f: HeaderExtra) {
    const val = extraValues[f.key] ?? "";
    if (f.kind === "check") {
      return (
        <div key={f.key} className="flex items-end">
          <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
            <input type="checkbox" checked={val === "true"} onChange={(e) => setExtra(f, e.target.checked ? "true" : "false")} />
            {f.label}
          </label>
        </div>
      );
    }
    if (f.kind === "account") {
      return (
        <div key={f.key}><label className="label">{f.label}</label>
          <select className="input" value={val} onChange={(e) => setExtra(f, e.target.value)}>
            <option value="">— default —</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select></div>
      );
    }
    if (f.kind === "date") {
      return <div key={f.key}><label className="label">{f.label}</label>
        <input type="date" className="input" value={val} onChange={(e) => setExtra(f, e.target.value)} /></div>;
    }
    if (f.kind === "text") {
      return <div key={f.key}><label className="label">{f.label}</label>
        <input className="input" value={val} onChange={(e) => setExtra(f, e.target.value)} /></div>;
    }
    const derived = !!f.derived && !overridden[f.key];
    return (
      <div key={f.key}>
        <label className="label">
          {f.label}
          {f.hint && <span className="ml-1 font-normal normal-case text-slate-400">({f.hint})</span>}
          {derived && <span className="ml-1 font-normal normal-case text-slate-400">· auto</span>}
        </label>
        <input className={`input text-right tabular-nums ${derived ? "bg-slate-50 text-slate-600" : ""}`} inputMode="decimal"
          value={val} onChange={(e) => setExtra(f, e.target.value)}
          placeholder={f.kind === "percent" ? "0.00" : f.kind === "int" ? "0" : "0.00"} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">{cfg.title}</h1>
        {isCar && <span className="rounded-full bg-brand/10 px-3 py-1 text-xs font-medium uppercase tracking-wide text-brand">car sales</span>}
        {done && <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-700 capitalize">{done}</span>}
      </div>

      <div className="card flex flex-wrap items-center gap-2 py-2">
        <button onClick={resetNew} disabled={busy} className="btn-outline text-sm">＋ New</button>
        <button onClick={() => nav("prev")} disabled={busy} className="btn-outline text-sm">‹ Previous</button>
        <button onClick={() => nav("next")} disabled={busy} className="btn-outline text-sm">Next ›</button>
        <div className="ml-auto flex items-center gap-2">
          {posted && <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium uppercase text-green-700">posted</span>}
          {canPost && id && !posted && <button onClick={post} disabled={busy} className="btn text-sm">Post to GL</button>}
          <button onClick={printDoc} disabled={!id} className="btn-outline text-sm disabled:opacity-40">🖨 Print</button>
          <button onClick={del} disabled={!id || busy || posted} className="btn-outline text-sm text-red-600 disabled:opacity-40">🗑 Delete</button>
        </div>
      </div>

      {err && <div className="rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{err}</div>}

      <div className="card space-y-4">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div><label className="label">Document No.</label>
            <input className="input font-mono" value={docNo} placeholder="Auto" onChange={(e) => setDocNo(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); loadByNo(); } }} /></div>
          <div><label className="label">Date</label><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          {/* Purchase / Sale Account sits right after Date. */}
          {headerExtras.filter((f) => f.kind === "account").map(headerField)}
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
          {cfg.showTagArea !== false && (
            <div><label className="label">Tag Area</label>
              <select className="input" value={tagArea} onChange={(e) => setTagArea(e.target.value)}>
                <option value="">—</option>{tagAreas.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select></div>
          )}
          <div><label className="label">Reference</label><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} /></div>
          {canPost && cfg.showWarehouse && (
            <div><label className="label">Warehouse</label>
              <select className="input" value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
                <option value="">— none (no stock) —</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select></div>
          )}
          {cfg.showMode && <div><label className="label">Mode of Payment</label><input className="input" value={mode} onChange={(e) => setMode(e.target.value)} /></div>}
          {cfg.showDue && <div><label className="label">Due Date</label><input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>}
          {cfg.showDelivery && <div><label className="label">Delivery Date</label><input type="date" className="input" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} /></div>}
          {headerExtras.filter((f) => f.kind === "check").map(headerField)}
          {cfg.showTerms && <div className="md:col-span-2"><label className="label">Terms</label><input className="input" value={terms} onChange={(e) => setTerms(e.target.value)} /></div>}
          <div className="md:col-span-2"><label className="label">Narration</label><input className="input" value={narration} onChange={(e) => setNarration(e.target.value)} /></div>
        </div>

        {/* Car-sales costing block — only for CAR SALES INSTALLMENT / CAR TRADING. */}
        {isCar && (cfg.carHeaderExtras?.length ?? 0) > 0 && (
          <div className="rounded-lg border border-brand/20 bg-brand/[0.03] p-4">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand">Car Sales Details</div>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {(cfg.carHeaderExtras ?? []).map(headerField)}
            </div>
          </div>
        )}

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-2 py-2 text-left">#</th>
                {cfg.tagAreaInLine && <th className="px-2 py-2 text-left">Tag Area</th>}
                <th className="px-2 py-2 text-left">Item</th>
                <th className="px-2 py-2 text-left">Units</th>
                <th className="px-2 py-2 text-right">{cfg.qtyLabel ?? "Quantity"}</th>
                {showRateAmount && <th className="px-2 py-2 text-right">Rate</th>}
                {showRateAmount && <th className="px-2 py-2 text-right">Amount</th>}
                {lineExtras.map((x) => <th key={x.key} className={`px-2 py-2 ${x.kind === "text" ? "text-left" : "text-right"}`}>{x.label}</th>)}
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-2 py-1 text-slate-400">{i + 1}</td>
                  {cfg.tagAreaInLine && (
                    <td className="px-2 py-1">
                      <select className="input w-32" value={r.extras.tag_area ?? ""} onChange={(e) => setRowExtra(i, "tag_area", e.target.value)}>
                        <option value="">—</option>{tagAreas.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                      </select>
                    </td>
                  )}
                  <td className="px-2 py-1 min-w-[220px]">
                    <input className="input" list="trade-products" value={r.item_name} onChange={(e) => pickItem(i, e.target.value)} placeholder="Item / product" />
                  </td>
                  <td className="px-2 py-1"><input className="input w-20" value={r.units} onChange={(e) => setRow(i, { units: e.target.value })} /></td>
                  <td className="px-2 py-1"><input className="input w-24 text-right tabular-nums" inputMode="decimal" value={r.quantity} onChange={(e) => setRow(i, { quantity: e.target.value })} /></td>
                  {showRateAmount && <td className="px-2 py-1"><input className="input w-28 text-right tabular-nums" inputMode="decimal" value={r.rate} onChange={(e) => setRow(i, { rate: e.target.value })} /></td>}
                  {showRateAmount && <td className="px-2 py-1"><input className="input w-32 text-right tabular-nums" inputMode="decimal" value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} /></td>}
                  {lineExtras.map((x) => (
                    <td key={x.key} className="px-2 py-1">
                      <input className={`input ${x.kind === "text" ? "w-40" : "w-28 text-right tabular-nums"}`}
                        inputMode={x.kind === "text" ? undefined : "decimal"}
                        value={r.extras[x.key] ?? ""} onChange={(e) => setRowExtra(i, x.key, e.target.value)} />
                    </td>
                  ))}
                  <td className="px-1 text-center"><button onClick={() => removeRow(i)} className="text-slate-300 hover:text-red-500" title="Remove">×</button></td>
                </tr>
              ))}
            </tbody>
            {showRateAmount && (
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                  <td /><td className="px-2 py-2 text-slate-500" colSpan={gridCols - lineExtras.length - 2}>Subtotal</td>
                  <td className="px-2 py-2 text-right tabular-nums">{money(subtotal)}</td>
                  {lineExtras.map((x) => (
                    <td key={x.key} className="px-2 py-2 text-right tabular-nums text-slate-500">
                      {x.kind === "text" ? "" : money(rows.reduce((s, r) => s + num(r.extras[x.key]), 0))}
                    </td>
                  ))}
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
          <datalist id="trade-products">{products.map((p) => <option key={p.id} value={p.name} />)}</datalist>
        </div>

        <div className="flex flex-wrap items-end justify-end gap-6">
          {costColumns.length > 0 && extraCosts !== 0 && (
            <div className="mr-auto text-sm">
              <span className="text-slate-500">Expenses on lines</span>
              <span className="ml-2 font-semibold tabular-nums text-slate-700">{money(extraCosts)}</span>
              <span className="ml-4 text-slate-500">Landed cost</span>
              <span className="ml-2 font-semibold tabular-nums text-slate-700">{money(landedCost)}</span>
              <div className="text-xs text-slate-400">Recorded on the lines for costing; the document total below stays the supplier&apos;s billed amount.</div>
            </div>
          )}
          {showRateAmount && <div><label className="label">Round Off</label><input className="input w-28 text-right tabular-nums" inputMode="decimal" value={roundOff} onChange={(e) => setRoundOff(e.target.value)} placeholder="0.00" /></div>}
          {showRateAmount && <div className="text-right"><div className="text-xs uppercase tracking-wide text-slate-400">Net Total</div><div className="text-2xl font-bold text-brand">{money(total)}</div></div>}
        </div>

        <div className="flex items-center gap-2">
          <button onClick={save} disabled={busy || posted} className="btn disabled:opacity-40">{busy ? "Saving…" : posted ? "Posted (locked)" : id ? "Save changes" : "Save"}</button>
          <button onClick={() => setRows((r) => [...r, blankRow()])} className="btn-outline text-sm">+ Line</button>
          <span className="ml-auto text-xs text-slate-400">{id ? `Editing ${docNo}` : "New document — number auto-assigned on save."}</span>
        </div>
      </div>
    </div>
  );
}
