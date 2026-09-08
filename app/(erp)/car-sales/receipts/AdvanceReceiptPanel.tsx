"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { dateStr } from "@/lib/format";
import { todaySA } from "@/lib/saudiTime";
import { sar } from "../lib";

export interface PendingOrder {
  id: string; doc_no: string; doc_date: string | null; party_name: string | null;
  cost_center: string | null; total: number; advance: number; received: number;
}

/* The advance is paid to hold the car, days or weeks before the Car Invoice is
   raised. Until now a receipt could only be taken from inside an invoice, so
   that money had nowhere to go. It is taken against the Sale Order here, and
   the invoice adopts it when it is raised — see migration 338. */
export default function AdvanceReceiptPanel({ orders }: { orders: PendingOrder[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [docId, setDocId] = useState("");
  const [date, setDate] = useState(todaySA());
  const [method, setMethod] = useState("cash");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");

  const order = orders.find((o) => o.id === docId) ?? null;
  const stillDue = order ? Math.max(0, order.advance - order.received) : 0;

  async function save() {
    if (!docId) { setErr("Choose the Sale Order this advance is against."); return; }
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("car_receipt_save", {
      p_id: null,
      p_header: { source_doc_id: docId, receipt_date: date, amount: String(Number(amount) || 0), method, reference },
      p_allocs: [],
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setDocId(""); setAmount(""); setReference(""); setOpen(false);
    router.refresh();
  }

  return (
    <section className="card space-y-3 border-l-4 border-emerald-400">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold text-slate-700">Advance on a Sale Order</h2>
        <span className="text-sm text-slate-500">
          {orders.length === 0 ? "No car sale order is waiting for its invoice." : `${orders.length} order${orders.length === 1 ? "" : "s"} not invoiced yet`}
        </span>
        <button className="btn-outline ml-auto text-sm" disabled={orders.length === 0} onClick={() => setOpen((o) => !o)}>
          {open ? "Close" : "Receive an advance"}
        </button>
      </div>

      {open && (
        <div className="space-y-3">
          {err && <div className="rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{err}</div>}
          <div className="grid gap-3 md:grid-cols-4">
            <div className="md:col-span-2">
              <label className="label">Sale Order</label>
              <select className="input" value={docId} onChange={(e) => { setDocId(e.target.value); const o = orders.find((x) => x.id === e.target.value); setAmount(o ? String(Math.max(0, o.advance - o.received) || "") : ""); }}>
                <option value="">Choose…</option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.doc_no} · {o.party_name ?? "—"} · {sar(o.total)}
                  </option>
                ))}
              </select>
            </div>
            <div><label className="label">Date</label><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div><label className="label">Method</label>
              <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="cash">Cash</option><option value="bank">Bank</option><option value="card">Card</option><option value="transfer">Transfer</option>
              </select>
            </div>
            <div><label className="label">Amount (SAR)</label><input type="number" step="0.01" className="input" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div className="md:col-span-3"><label className="label">Reference</label><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Cheque / transfer ref" /></div>
          </div>

          {order && (
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              {order.doc_no} of {dateStr(order.doc_date)} · advance agreed <b>{sar(order.advance)}</b>
              {order.received > 0 && <> · already received <b>{sar(order.received)}</b></>}
              {" · "}still to receive <b>{sar(stillDue)}</b>
            </div>
          )}

          <p className="text-xs text-slate-400">
            Posts as cash (or bank) against <b>{order?.party_name ?? "the customer"}</b>’s own account, so they stand in credit
            until the Car Invoice is raised. The invoice takes this receipt over — the advance never shows as due twice.
          </p>

          <div className="flex justify-end">
            <button className="btn" disabled={busy || !docId || !(Number(amount) > 0)} onClick={save}>{busy ? "Saving…" : "Save receipt"}</button>
          </div>
        </div>
      )}
    </section>
  );
}
