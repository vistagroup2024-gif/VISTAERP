"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { dateStr } from "@/lib/format";
import MultiSelectFilter from "@/components/MultiSelectFilter";
import { SCHARGE_STATUS_LABEL, SCHARGE_STATUS_TONE, schargeStatus, monthLabel, sar } from "../lib";

export interface ChargeRow {
  id: string; charge_month: string | null; due_date: string | null; amount: number; paid: number;
  vehicle_id: string | null; vehicle: string; plate: string | null; ownership: string; customer: string | null;
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${tone ?? "text-slate-800"}`}>{value}</div>
    </div>
  );
}

export default function ServiceChargesTable({ rows }: { rows: ChargeRow[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string[]>([]);
  const [pay, setPay] = useState<null | { id: string; vehicle: string; month: string | null; remaining: number }>(null);

  const withStatus = useMemo(() => rows.map((r) => ({ ...r, st: schargeStatus(r.amount, r.paid, r.due_date) })), [rows]);
  const thisMonth = new Date().toISOString().slice(0, 7);
  const totals = {
    thisMonth: withStatus.filter((r) => (r.charge_month ?? "").slice(0, 7) === thisMonth).reduce((a, r) => a + r.amount, 0),
    collected: withStatus.reduce((a, r) => a + r.paid, 0),
    outstanding: withStatus.reduce((a, r) => a + Math.max(0, r.amount - r.paid), 0),
    overdue: withStatus.filter((r) => r.st === "overdue").reduce((a, r) => a + Math.max(0, r.amount - r.paid), 0),
    vehicles: new Set(withStatus.filter((r) => r.ownership === "vista").map((r) => r.vehicle_id)).size,
  };

  const filtered = useMemo(() => withStatus.filter((r) => {
    if (status.length && !status.includes(r.st)) return false;
    if (q && ![r.vehicle, r.plate, r.customer].filter(Boolean).join(" ").toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [withStatus, status, q]);

  async function generate() {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("car_generate_service_charges", {});
    setBusy(false);
    if (error) return setErr(error.message);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {err && <div className="rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{err}</div>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Stat label="This Month" value={sar(totals.thisMonth)} />
        <Stat label="Collected" value={sar(totals.collected)} tone="text-emerald-700" />
        <Stat label="Outstanding" value={sar(totals.outstanding)} />
        <Stat label="Overdue" value={sar(totals.overdue)} tone="text-red-600" />
        <Stat label="Vehicles (Vista)" value={totals.vehicles} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Search vehicle / customer…" value={q} onChange={(e) => setQ(e.target.value)} />
        <MultiSelectFilter label="Status" options={Object.keys(SCHARGE_STATUS_LABEL).map((k) => ({ value: k, label: SCHARGE_STATUS_LABEL[k] }))} selected={status} onChange={setStatus} />
        <button className="btn-outline text-sm" disabled={busy} onClick={generate}>{busy ? "Generating…" : "Generate charges"}</button>
        <span className="ml-auto text-sm text-slate-500">{filtered.length} / {rows.length}</span>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[860px]">
          <thead className="bg-slate-50"><tr>
            <th className="th">Vehicle</th><th className="th">Customer</th><th className="th">Charge Month</th><th className="th">Due Date</th>
            <th className="th text-right">Amount</th><th className="th text-right">Paid</th><th className="th text-right">Outstanding</th>
            <th className="th">Status</th><th className="th text-right">Actions</th>
          </tr></thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="td">{r.vehicle_id ? <Link href={`/car-sales/vehicles/${r.vehicle_id}`} className="text-brand hover:underline">{r.vehicle}</Link> : r.vehicle}<div className="text-xs text-slate-400">{r.plate ?? ""}</div></td>
                <td className="td">{r.customer ?? "—"}</td>
                <td className="td">{monthLabel(r.charge_month)}</td>
                <td className="td">{dateStr(r.due_date)}</td>
                <td className="td text-right tabular-nums">{sar(r.amount)}</td>
                <td className="td text-right tabular-nums">{sar(r.paid)}</td>
                <td className="td text-right tabular-nums">{sar(r.amount - r.paid)}</td>
                <td className="td"><span className={`badge ${SCHARGE_STATUS_TONE[r.st] ?? "bg-slate-100"}`}>{SCHARGE_STATUS_LABEL[r.st] ?? r.st}</span></td>
                <td className="td text-right">
                  {r.paid < r.amount && <button className="text-brand hover:underline" onClick={() => setPay({ id: r.id, vehicle: r.vehicle, month: r.charge_month, remaining: r.amount - r.paid })}>Pay</button>}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td className="td text-slate-400" colSpan={9}>No charges. Use “Generate charges”.</td></tr>}
          </tbody>
        </table>
      </div>

      {pay && <PayModal charge={pay} onClose={() => setPay(null)} onDone={() => { setPay(null); router.refresh(); }} />}
    </div>
  );
}

function PayModal({ charge, onClose, onDone }: { charge: { id: string; vehicle: string; month: string | null; remaining: number }; onClose: () => void; onDone: () => void }) {
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [amount, setAmount] = useState(String(charge.remaining));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");

  async function save() {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("car_scharge_pay", { p_charge: charge.id, p_amount: Number(amount), p_date: date, p_method: method, p_ref: reference });
    setBusy(false);
    if (error) return setErr(error.message);
    onDone();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-lg bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold">Service Charge Payment</h3>
        <p className="mb-3 text-xs text-slate-500">{charge.vehicle} · {monthLabel(charge.month)} · remaining {sar(charge.remaining)}</p>
        {err && <div className="mb-2 rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{err}</div>}
        <div className="space-y-3">
          <div><label className="label">Amount (SAR)</label><input type="number" step="0.01" className="input" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Date</label><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div><label className="label">Method</label><select className="input" value={method} onChange={(e) => setMethod(e.target.value)}><option value="cash">Cash</option><option value="bank">Bank</option><option value="card">Card</option><option value="transfer">Transfer</option></select></div>
          </div>
          <div><label className="label">Reference</label><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} /></div>
        </div>
        <div className="mt-4 flex gap-2">
          <button className="btn" disabled={busy || Number(amount) <= 0} onClick={save}>{busy ? "Saving…" : "Save payment"}</button>
          <button className="btn-outline" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
