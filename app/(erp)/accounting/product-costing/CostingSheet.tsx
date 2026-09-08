"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import SearchSelect from "@/components/ui/SearchSelect";
import { todaySA } from "@/lib/saudiTime";
import { dateStr } from "@/lib/format";
import type { DocRight } from "@/lib/docRights";

type Product = { id: string; name: string; uom: string | null; purchase_rate: number | null; sell_rate: number | null };
type SheetRow = {
  id: string; sheet_no: string; sheet_date: string; item: string;
  quantity: number; uom: string | null; cost_total: number; cost_per_unit: number;
  margin_pct: number; sell_price: number; applied_at: string | null;
};
type Kind = "rate" | "amount" | "percent";
type Line = { component: string; kind: Kind; rate: string; quantity: string; percent: string; amount: string; notes: string };

const money = (n: any) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
const num = (s: any) => Number(String(s ?? "").replace(/,/g, "")) || 0;
const blankLine = (): Line => ({ component: "", kind: "rate", rate: "", quantity: "", percent: "", amount: "", notes: "" });
const blank = () => ({
  id: null as string | null, sheet_no: "", sheet_date: todaySA(),
  product_id: "", item_name: "", quantity: "1", uom: "", margin_pct: "20", narration: "",
});

/**
 * Product Costing — the cost sheet you fill in before you quote.
 *
 * What goes into this item, what does it come to per unit, and what should it
 * sell for. Three kinds of line, because costs arrive in three shapes: a rate
 * per unit, a lump sum for the lot, and a percentage of what sits above it.
 *
 * The percentage kind is why ORDER matters and why the arithmetic is worth
 * spelling out: an overhead is a share of the costs it sits on, not of the
 * whole sheet including itself. The running total beside each line is the
 * figure the next percentage line will be taken on, so what a 5% line will do
 * is visible before it is typed. The database rebuilds all of it on save rather
 * than trusting these numbers — the sheet has to add up.
 *
 * Nothing posts. A cost sheet is a plan; the ledger hears about it when the
 * purchase and the sale do. Apply to Item writes the answer onto the Product
 * Tree, and it is a separate button because master data is the user's.
 */
export default function CostingSheet({ products, sheets, rights }: {
  products: Product[]; sheets: SheetRow[]; rights?: Partial<Record<DocRight, boolean>>;
}) {
  const may = (r: DocRight) => (rights ? !!rights[r] : true);
  const router = useRouter();
  const supabase = createClient();
  const [h, setH] = useState(blank());
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const qty = Math.max(num(h.quantity), 0);
  const product = useMemo(() => products.find((p) => p.id === h.product_id) ?? null, [products, h.product_id]);

  // Each line's amount, and the running total it was taken on — the same walk
  // the database does, so what is on screen is what will be saved.
  const computed = useMemo(() => {
    let running = 0;
    const out = lines.map((l) => {
      const amt =
        l.kind === "amount" ? num(l.amount)
        : l.kind === "percent" ? Math.round(running * num(l.percent)) / 100
        : num(l.rate) * (l.quantity.trim() === "" ? qty : num(l.quantity));
      const rounded = Math.round(amt * 100) / 100;
      const base = running;
      running = Math.round((running + rounded) * 100) / 100;
      return { amount: rounded, base, running };
    });
    return { rows: out, total: running };
  }, [lines, qty]);

  const perUnit = qty > 0 ? computed.total / qty : 0;
  const sell = perUnit * (1 + num(h.margin_pct) / 100);

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((a) => a.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  function pickProduct(id: string) {
    const p = products.find((x) => x.id === id);
    setH((c) => ({ ...c, product_id: id, item_name: "", uom: c.uom || (p?.uom ?? "") }));
  }

  function reset(keep?: string) {
    setH(blank()); setLines([blankLine()]); setErr(null); setDone(keep ?? null);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!h.product_id && !h.item_name.trim()) { setErr("Name the item this sheet is for."); return; }
    setBusy(true); setErr(null); setDone(null);
    const { data, error } = await supabase.rpc("costing_sheet_save", {
      p_id: h.id,
      p_header: {
        sheet_date: h.sheet_date, product_id: h.product_id || null,
        item_name: h.item_name || null, quantity: h.quantity,
        uom: h.uom || null, margin_pct: h.margin_pct, narration: h.narration || null,
      },
      p_lines: lines.filter((l) => l.component.trim()).map((l) => ({
        component: l.component, kind: l.kind, rate: l.rate,
        quantity: l.quantity === "" ? null : l.quantity,
        percent: l.percent, amount: l.amount, notes: l.notes,
      })),
    });
    setBusy(false);
    if (error) return setErr(error.message);
    const r = data as any;
    reset(`${r.sheet_no} saved — ${money(r.cost_per_unit)} per unit`);
    router.refresh();
  }

  async function open(id: string) {
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc("costing_sheet_get", { p_id: id });
    setBusy(false);
    if (error) return setErr(error.message);
    const v = data as any;
    if (!v) return setErr("Cost sheet not found.");
    setH({
      id: v.id, sheet_no: v.sheet_no, sheet_date: v.sheet_date,
      product_id: v.product_id ?? "", item_name: v.product_id ? "" : (v.item_name ?? ""),
      quantity: String(v.quantity ?? 1), uom: v.uom ?? "",
      margin_pct: String(v.margin_pct ?? 0), narration: v.narration ?? "",
    });
    setLines(((v.lines ?? []) as any[]).map((l) => ({
      component: l.component ?? "", kind: (l.kind ?? "rate") as Kind,
      rate: l.rate ? String(Number(l.rate)) : "",
      quantity: l.quantity == null ? "" : String(Number(l.quantity)),
      percent: l.percent ? String(Number(l.percent)) : "",
      amount: l.amount ? String(Number(l.amount)) : "",
      notes: l.notes ?? "",
    })).concat(blankLine()));
    setDone(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function applyToItem() {
    if (!h.id) return;
    if (!confirm(`Write this sheet onto the item?\n\n  Purchase rate → ${money(perUnit)}\n  Selling rate  → ${money(sell)}\n\nThe Product Tree is master data, so this is the only thing that changes it.`)) return;
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc("costing_sheet_apply",
      { p_id: h.id, p_cost: true, p_sell: true });
    setBusy(false);
    if (error) return setErr(error.message);
    setDone(`written onto ${(data as any)?.item ?? "the item"}`);
    router.refresh();
  }

  async function del(id: string) {
    if (!confirm("Delete this cost sheet? It posts nothing, so nothing is reversed — the working-out just goes.")) return;
    const { error } = await supabase.rpc("costing_sheet_delete", { p_id: id });
    if (error) return setErr(error.message);
    if (h.id === id) reset();
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">
        What goes into an item, what it comes to per unit, and what it should sell for. Nothing posts:
        a cost sheet is the working-out behind a quotation, and the ledger hears about it when the
        purchase and the sale do.
      </p>

      {err && <div className="rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{err}</div>}
      {done && <div className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{done}</div>}

      <form onSubmit={save} className="card space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold text-slate-700">{h.id ? `Cost sheet ${h.sheet_no}` : "New cost sheet"}</h2>
          {h.id && <button type="button" onClick={() => reset()} className="text-xs text-brand hover:underline">start a new one</button>}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2"><label className="label">Item</label>
            <SearchSelect value={h.product_id} onChange={pickProduct} placeholder="— not from the Product Tree —"
              options={products.map((p) => ({ value: p.id, label: p.name, hint: p.uom ?? undefined }))} />
            {!h.product_id && (
              <input className="input mt-2" placeholder="Name it instead"
                value={h.item_name} onChange={(e) => setH({ ...h, item_name: e.target.value })} />
            )}
            {product && (
              <p className="mt-1 text-xs text-slate-400">
                Product Tree today: cost {money(product.purchase_rate)} · sells {money(product.sell_rate)}
              </p>
            )}
          </div>
          <div><label className="label">Date</label>
            <input type="date" className="input" value={h.sheet_date} onChange={(e) => setH({ ...h, sheet_date: e.target.value })} /></div>
          <div><label className="label">Quantity</label>
            <input className="input text-right tabular-nums" inputMode="decimal"
              value={h.quantity} onChange={(e) => setH({ ...h, quantity: e.target.value })} />
            <input className="input mt-2" placeholder="unit (pax, NOS…)"
              value={h.uom} onChange={(e) => setH({ ...h, uom: e.target.value })} /></div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-2 py-2 text-left">Component</th>
                <th className="px-2 py-2 text-left">How</th>
                <th className="px-2 py-2 text-right">Rate / %</th>
                <th className="px-2 py-2 text-right">Qty</th>
                <th className="px-2 py-2 text-right">Amount</th>
                <th className="px-2 py-2 text-right">Running</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-2 py-1">
                    <input className="input" value={l.component} placeholder="Visa, Hotel, Overhead…"
                      onChange={(e) => {
                        setLine(i, { component: e.target.value });
                        if (i === lines.length - 1 && e.target.value.trim()) setLines((a) => [...a, blankLine()]);
                      }} />
                  </td>
                  <td className="px-2 py-1">
                    <select className="input" value={l.kind} onChange={(e) => setLine(i, { kind: e.target.value as Kind })}>
                      <option value="rate">Rate × Qty</option>
                      <option value="amount">Lump sum</option>
                      <option value="percent">% of above</option>
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    {l.kind === "percent" ? (
                      <input className="input text-right tabular-nums" inputMode="decimal" value={l.percent}
                        onChange={(e) => setLine(i, { percent: e.target.value })} placeholder="%" />
                    ) : l.kind === "amount" ? (
                      <span className="block px-2 text-right text-slate-300">—</span>
                    ) : (
                      <input className="input text-right tabular-nums" inputMode="decimal" value={l.rate}
                        onChange={(e) => setLine(i, { rate: e.target.value })} />
                    )}
                  </td>
                  <td className="px-2 py-1">
                    {l.kind === "rate" ? (
                      <input className="input text-right tabular-nums" inputMode="decimal" value={l.quantity}
                        placeholder={String(qty)} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                    ) : <span className="block px-2 text-right text-slate-300">—</span>}
                  </td>
                  <td className="px-2 py-1">
                    {l.kind === "amount" ? (
                      <input className="input text-right tabular-nums" inputMode="decimal" value={l.amount}
                        onChange={(e) => setLine(i, { amount: e.target.value })} />
                    ) : (
                      <span className="block px-2 text-right tabular-nums">{money(computed.rows[i]?.amount)}</span>
                    )}
                  </td>
                  {/* What the next "% of above" line will be taken on. */}
                  <td className="px-2 py-1 text-right tabular-nums text-slate-400">{money(computed.rows[i]?.running)}</td>
                  <td className="px-2 py-1 text-right">
                    {lines.length > 1 && (
                      <button type="button" onClick={() => setLines((a) => a.filter((_, x) => x !== i))}
                        className="text-slate-300 hover:text-red-500">×</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
          <div>
            <label className="label">Narration</label>
            <input className="input" value={h.narration} onChange={(e) => setH({ ...h, narration: e.target.value })} />
            <label className="label mt-3">Margin on cost (%)</label>
            <input className="input max-w-[8rem] text-right tabular-nums" inputMode="decimal"
              value={h.margin_pct} onChange={(e) => setH({ ...h, margin_pct: e.target.value })} />
          </div>
          <dl className="space-y-1 self-end rounded-lg bg-slate-50 p-3 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Total cost</dt>
              <dd className="font-semibold tabular-nums">{money(computed.total)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Cost per {h.uom || "unit"}</dt>
              <dd className="font-semibold tabular-nums">{money(perUnit)}</dd></div>
            <div className="flex justify-between border-t border-slate-200 pt-1">
              <dt className="text-slate-600">Sell at (+{num(h.margin_pct)}%)</dt>
              <dd className="font-bold tabular-nums text-brand-700">{money(sell)}</dd></div>
          </dl>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          <button className="btn disabled:opacity-40" disabled={busy || !(h.id ? may("edit") : may("create"))}>
            {busy ? "Saving…" : h.id ? "Save changes" : "Save cost sheet"}
          </button>
          <button type="button" className="btn-outline" onClick={() => reset()}>Clear</button>
          <button type="button" onClick={applyToItem} className="btn-outline ml-auto disabled:opacity-40"
            disabled={busy || !h.id || !h.product_id}
            title={!h.id ? "Save the sheet first" : !h.product_id ? "Only an item from the Product Tree can be written to" : undefined}>
            Apply to Item
          </button>
        </div>
      </form>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-800">Cost sheets</h2>
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <tr><th className="px-3 py-2 text-left">No.</th><th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Item</th><th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Total cost</th><th className="px-3 py-2 text-right">Per unit</th>
                <th className="px-3 py-2 text-right">Sell at</th><th className="px-3 py-2" /></tr>
            </thead>
            <tbody>
              {sheets.map((s) => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-xs">
                    {s.sheet_no}
                    {s.applied_at && <span className="ml-2 rounded bg-green-100 px-1.5 text-[10px] uppercase text-green-700">applied</span>}
                  </td>
                  <td className="px-3 py-2">{dateStr(s.sheet_date)}</td>
                  <td className="px-3 py-2">{s.item}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.quantity}{s.uom ? ` ${s.uom}` : ""}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(s.cost_total)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(s.cost_per_unit)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{money(s.sell_price)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button onClick={() => open(s.id)} className="text-brand hover:underline">Open</button>
                    <button onClick={() => del(s.id)} disabled={!may("delete")} title={may("delete") ? undefined : "You don't have Delete rights on this screen"}
                      className="ml-3 text-red-500 hover:underline disabled:opacity-40">Delete</button>
                  </td>
                </tr>
              ))}
              {sheets.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-400">No cost sheets yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
