"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import AccountPicker, { type PickAccount } from "./AccountPicker";

type Named = { id: string; name: string };
const num = (s: string) => (s.trim() === "" ? 0 : Number(s) || 0);
const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

// Stock Receipt / Issue / Adjustment. Moving-average valuation; optional GL post
// (receipt Dr Inventory / Cr counter; issue Dr COGS / Cr Inventory at avg cost).
export default function StockMovement({ counterAccounts }: { counterAccounts: PickAccount[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [type, setType] = useState<"receipt" | "issue" | "adjust">("receipt");
  const [items, setItems] = useState<Named[]>([]);
  const [warehouses, setWarehouses] = useState<Named[]>([]);
  const [item, setItem] = useState("");
  const [wh, setWh] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [qty, setQty] = useState("");
  const [rate, setRate] = useState("");
  const [reference, setReference] = useState("");
  const [narration, setNarration] = useState("");
  const [postGl, setPostGl] = useState(true);
  const [counter, setCounter] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: it }, { data: w }] = await Promise.all([
        supabase.from("acct_products").select("id, name").eq("is_group", false).eq("is_active", true).eq("is_stock", true).order("name"),
        supabase.from("warehouses").select("id, name").eq("is_active", true).order("name"),
      ]);
      setItems((it as any[]) ?? []); setWarehouses((w as any[]) ?? []);
    })();
  }, [supabase]);

  const value = useMemo(() => (type === "issue" ? 0 : num(qty) * num(rate)), [type, qty, rate]);

  async function save() {
    setErr(null); setDone(null);
    if (!item) return setErr("Choose an item");
    if (!wh) return setErr("Choose a warehouse");
    if (num(qty) <= 0) return setErr("Enter a quantity");
    if (type !== "issue" && num(rate) <= 0) return setErr("Enter the rate");
    if (type === "receipt" && postGl && !counter) return setErr("Choose the counter account (supplier / cash) or turn off GL posting");
    setBusy(true);
    const { data, error } = await supabase.rpc("stock_move", {
      p_type: type, p_item: item, p_wh: wh, p_qty: num(qty), p_rate: num(rate), p_date: date,
      p_reference: reference || null, p_narration: narration || null, p_post_gl: postGl, p_counter: counter,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    const r = data as any;
    setDone(`${r.doc_no} · value ${money(Number(r.value))}${type === "issue" ? ` @ avg ${money(Number(r.rate))}` : ""}`);
    setQty(""); setRate(""); setReference(""); setNarration(""); router.refresh();
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex gap-2">
        {(["receipt", "issue", "adjust"] as const).map((t) => (
          <button key={t} onClick={() => setType(t)}
            className={`rounded-full px-3 py-1 text-sm capitalize ${type === t ? "bg-brand text-white" : "bg-slate-100 text-slate-600"}`}>{t}</button>
        ))}
      </div>
      {err && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
      {done && <div className="rounded bg-green-50 px-3 py-2 text-sm text-green-700">Posted {done}</div>}

      <div className="card grid grid-cols-2 gap-4">
        <div className="col-span-2"><label className="label">Item</label>
          <select className="input" value={item} onChange={(e) => setItem(e.target.value)}>
            <option value="">— select stock item —</option>{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          {items.length === 0 && <p className="mt-1 text-xs text-amber-600">No stock items yet — mark products as stock items in the Product Tree (Rates → Stock).</p>}
        </div>
        <div><label className="label">Warehouse</label>
          <select className="input" value={wh} onChange={(e) => setWh(e.target.value)}>
            <option value="">— select —</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select></div>
        <div><label className="label">Date</label><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div><label className="label">Quantity</label><input className="input text-right tabular-nums" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
        {type !== "issue" && <div><label className="label">Rate (cost)</label><input className="input text-right tabular-nums" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></div>}
        {type === "issue" && <div className="flex items-end text-sm text-slate-500">Issued at moving-average cost.</div>}
        <div><label className="label">Reference</label><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} /></div>
        <div><label className="label">Narration</label><input className="input" value={narration} onChange={(e) => setNarration(e.target.value)} /></div>

        <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={postGl} onChange={(e) => setPostGl(e.target.checked)} /> Post to General Ledger</label>
        {postGl && type !== "issue" && (
          <div className="col-span-2"><label className="label">Counter account (credit) — supplier / cash</label>
            <AccountPicker accounts={counterAccounts} value={counter} onChange={setCounter} placeholder="Account…" /></div>
        )}
        {value > 0 && <div className="col-span-2 text-right text-sm text-slate-500">Value: <b className="tabular-nums">{money(value)}</b></div>}

        <div className="col-span-2"><button onClick={save} disabled={busy} className="btn">{busy ? "Posting…" : "Post movement"}</button></div>
      </div>
    </div>
  );
}
