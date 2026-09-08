"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { dateStr } from "@/lib/format";
import { todaySA } from "@/lib/saudiTime";
import AccountPicker, { type PickAccount } from "./AccountPicker";
import SearchSelect from "@/components/ui/SearchSelect";

type Order = {
  id: string; doc_no: string; doc_date: string | null; party_name: string | null;
  cost_center: string | null; total: number; advance: number; received: number;
};

const money = (n: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/* The advance is paid to hold the car, days or weeks before the Car Invoice is
   raised. It is money coming in, so it is taken on the Receipt voucher like any
   other — this is that voucher's second tab, not a screen of its own. What makes
   it different is only what it is against: a Sale Order rather than a ledger
   account. The Car Invoice adopts the receipt when it is raised (migration 338),
   so the advance is never asked for twice. */
export default function AdvanceReceiptForm({ cashBank }: { cashBank: PickAccount[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [docId, setDocId] = useState("");
  const [date, setDate] = useState(todaySA());
  const [cash, setCash] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  const load = useMemo(() => async () => {
    setLoading(true);
    // car_pending_sale_orders is the one authority on "a car sale order still
    // waiting for its invoice". The agreed advance lives in the order's own Car
    // Sales Details, and what has come in is on the receipts themselves.
    const { data: pending, error } = await supabase.rpc("car_pending_sale_orders");
    if (error) { setErr(error.message); setLoading(false); return; }
    const rows = (pending ?? []) as any[];
    const ids = rows.map((o) => o.id);
    const [{ data: metas }, { data: taken }] = ids.length
      ? await Promise.all([
          supabase.from("trade_documents").select("id, meta").in("id", ids),
          supabase.from("car_receipts").select("source_doc_id, amount").in("source_doc_id", ids),
        ])
      : [{ data: [] as any[] }, { data: [] as any[] }];
    const advanceOf = new Map<string, number>((metas ?? []).map((d: any) => [d.id, num(d.meta?.advance)]));
    const receivedOf = new Map<string, number>();
    for (const t of (taken ?? []) as any[]) {
      receivedOf.set(t.source_doc_id, (receivedOf.get(t.source_doc_id) ?? 0) + num(t.amount));
    }
    setOrders(rows.map((o) => ({
      id: o.id, doc_no: o.doc_no, doc_date: o.doc_date, party_name: o.party_name,
      cost_center: o.cost_center, total: num(o.total),
      advance: advanceOf.get(o.id) ?? 0, received: receivedOf.get(o.id) ?? 0,
    })));
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const order = orders.find((o) => o.id === docId) ?? null;
  const stillDue = order ? Math.max(0, order.advance - order.received) : 0;

  function pickOrder(id: string) {
    setDocId(id);
    const o = orders.find((x) => x.id === id);
    const rest = o ? Math.max(0, o.advance - o.received) : 0;
    setAmount(rest > 0 ? String(rest) : "");
  }

  async function save() {
    setErr(null); setDone(null);
    if (!docId) return setErr("Choose the Sale Order this advance is against.");
    if (!cash) return setErr("Choose the cash / bank account the money went into.");
    if (!(Number(amount) > 0)) return setErr("Enter an amount.");
    setBusy(true);
    const { error } = await supabase.rpc("car_receipt_save", {
      p_id: null,
      p_header: {
        source_doc_id: docId, receipt_date: date, amount: String(Number(amount)),
        cash_account_id: cash, method: "cash", reference, notes,
      },
      p_allocs: [],
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setDone(`received ${money(Number(amount))} on ${order?.doc_no ?? "the order"} — ready for the next one`);
    setDocId(""); setAmount(""); setReference(""); setNotes("");
    await load();
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {err && <div className="rounded-md border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{err}</div>}
      {done && <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{done}</div>}

      <div className="card space-y-4">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="col-span-2">
            <label className="label">Sale Order</label>
            <SearchSelect value={docId} onChange={pickOrder} placeholder={loading ? "Loading…" : "Choose the order…"}
              options={orders.map((o) => ({ value: o.id, label: `${o.doc_no} · ${o.party_name ?? "—"} · ${money(o.total)}` }))} />
          </div>
          <div><label className="label">Date</label>
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><label className="label">Cash / Bank</label>
            <AccountPicker accounts={cashBank} value={cash} onChange={setCash} placeholder="Cash / bank…" /></div>
          <div><label className="label">Amount</label>
            <input className="input text-right tabular-nums" inputMode="decimal" value={amount}
              onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></div>
          <div><label className="label">Reference</label>
            <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Cheque / ref no" /></div>
          <div className="col-span-2"><label className="label">Narration</label>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></div>
        </div>

        {order && (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            {order.doc_no} of {dateStr(order.doc_date)} · {order.cost_center ?? "—"} · advance agreed{" "}
            <b className="text-slate-800 tabular-nums">{money(order.advance)}</b>
            {order.received > 0 && <> · already received <b className="text-slate-800 tabular-nums">{money(order.received)}</b></>}
            {" · "}still to receive <b className="text-slate-800 tabular-nums">{money(stillDue)}</b>
          </div>
        )}

        <p className="text-xs text-slate-400">
          Posts to <b>{order?.party_name ?? "the customer"}</b>’s own account, so they stand in credit until the
          Car Invoice charges them. The Car Invoice takes this receipt over when it is raised — the advance is never due twice.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-500">
          {loading ? "…" : orders.length === 0
            ? "No car sale order is waiting for its invoice."
            : `${orders.length} car sale order${orders.length === 1 ? "" : "s"} not invoiced yet`}
        </span>
        <button type="button" className="btn" disabled={busy || !docId || !cash || !(Number(amount) > 0)} onClick={save}>
          {busy ? "Saving…" : "Save receipt"}
        </button>
      </div>
    </div>
  );
}
