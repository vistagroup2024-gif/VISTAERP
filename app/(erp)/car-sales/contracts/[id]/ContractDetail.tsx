"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { dateStr } from "@/lib/format";
import { CONTRACT_STATUS_LABEL, CONTRACT_STATUS_TONE, INST_STATUS_LABEL, INST_STATUS_TONE, instStatus, sar, vehicleTitle } from "../../lib";

function Money({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${tone ?? "text-slate-800"}`}>{value}</div>
    </div>
  );
}

export default function ContractDetail({ contract, installments, receipts = [], commission = null, canManage, canReceipts, canOwnership, canCost }: {
  contract: any; installments: any[]; receipts?: any[]; commission?: any; canManage: boolean; canReceipts: boolean; canOwnership: boolean; canCost: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const paid = installments.reduce((a, i) => a + Number(i.paid_amount || 0), 0);
  const schedTotal = installments.reduce((a, i) => a + Number(i.amount || 0), 0);
  const outstanding = Number(contract.sale_price || 0) - Number(contract.advance || 0) - paid;
  const overdue = installments.reduce((a, i) => a + (i.due_date < today ? Math.max(0, Number(i.amount || 0) - Number(i.paid_amount || 0)) : 0), 0);
  const dueNow = installments.filter((i) => i.due_date <= today).reduce((a, i) => a + Math.max(0, Number(i.amount || 0) - Number(i.paid_amount || 0)), 0);
  const next = installments.filter((i) => Number(i.paid_amount || 0) < Number(i.amount || 0)).sort((a, b) => (a.due_date < b.due_date ? -1 : 1))[0];
  const st = contract.status as string;

  async function call(fn: string, msg?: string) {
    if (msg && !confirm(msg)) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc(fn, { p_id: contract.id });
    setBusy(false);
    if (error) return setErr(error.message);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {err && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      <div className="card flex flex-wrap items-center gap-3">
        <span className={`badge ${CONTRACT_STATUS_TONE[st] ?? "bg-slate-100"}`}>{CONTRACT_STATUS_LABEL[st] ?? st}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          {canManage && st === "draft" && <Link href={`/car-sales/contracts/${contract.id}/edit`} className="btn-outline text-sm">Edit</Link>}
          {canManage && st === "draft" && <button disabled={busy} className="btn text-sm" onClick={() => call("car_contract_activate", "Activate this contract? The vehicle will be marked Sold.")}>Activate</button>}
          {canManage && (st === "draft" || st === "active") && <button disabled={busy} className="btn-outline text-sm text-red-600" onClick={() => call("car_contract_cancel", "Cancel this contract?")}>Cancel</button>}
        </div>
      </div>

      {/* Financial summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <Money label="Contract Value" value={sar(contract.sale_price)} />
        <Money label="Advance" value={sar(contract.advance)} />
        <Money label="Total Paid" value={sar(paid)} tone="text-emerald-700" />
        <Money label="Outstanding" value={sar(outstanding)} />
        <Money label="Due Now" value={sar(dueNow)} tone="text-amber-700" />
        <Money label="Overdue" value={sar(overdue)} tone="text-red-600" />
        <Money label="Next Payment" value={next ? sar(Number(next.amount) - Number(next.paid_amount)) : "—"} />
      </div>
      {next && <p className="text-sm text-slate-500">Next payment due <b>{dateStr(next.due_date)}</b> · installment #{next.inst_no}.</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card">
          <h2 className="mb-3 font-semibold text-slate-700">Customer & Vehicle</h2>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-slate-400">Customer</dt><dd className="font-medium">{contract.customer_name ?? "—"}</dd>
            <dt className="text-slate-400">Mobile</dt><dd className="font-medium">{contract.customer_phone ?? "—"}</dd>
            <dt className="text-slate-400">Vehicle</dt><dd className="font-medium">{vehicleTitle(contract.vehicle ?? {})}</dd>
            <dt className="text-slate-400">Plate / VIN</dt><dd className="font-medium">{[contract.vehicle?.plate_no, contract.vehicle?.vin].filter(Boolean).join(" · ") || "—"}</dd>
            <dt className="text-slate-400">Reference</dt><dd className="font-medium">{contract.reference_name ?? "—"}</dd>
            <dt className="text-slate-400">Salesperson</dt><dd className="font-medium">{contract.salesperson ?? "—"}</dd>
          </dl>
        </section>
        <section className="card">
          <h2 className="mb-3 font-semibold text-slate-700">Dates & Value</h2>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-slate-400">Contract Date</dt><dd className="font-medium">{dateStr(contract.contract_date)}</dd>
            <dt className="text-slate-400">Start Date</dt><dd className="font-medium">{dateStr(contract.start_date)}</dd>
            <dt className="text-slate-400">Delivery Date</dt><dd className="font-medium">{dateStr(contract.delivery_date)}</dd>
            <dt className="text-slate-400">Expected Completion</dt><dd className="font-medium">{dateStr(contract.expected_completion_date)}</dd>
            {canCost && <><dt className="text-slate-400">Purchase Cost</dt><dd className="font-medium">{sar(contract.purchase_cost)}</dd></>}
            {canCost && <><dt className="text-slate-400">Gross Profit</dt><dd className="font-medium text-emerald-700">{sar(Number(contract.sale_price || 0) - Number(contract.purchase_cost || 0))}</dd></>}
          </dl>
        </section>
      </div>

      <section className="card overflow-x-auto p-0">
        <div className="flex items-center justify-between px-4 pt-4">
          <h2 className="font-semibold text-slate-700">Installment Schedule</h2>
          <span className="text-sm text-slate-400">{installments.length} installments · {sar(schedTotal)}</span>
        </div>
        <table className="mt-2 w-full min-w-[640px]">
          <thead className="bg-slate-50"><tr>
            <th className="th">No.</th><th className="th">Due Date</th><th className="th text-right">Amount</th>
            <th className="th text-right">Paid</th><th className="th text-right">Remaining</th><th className="th">Status</th>
          </tr></thead>
          <tbody>
            {installments.map((i) => {
              const s = instStatus(Number(i.amount), Number(i.paid_amount), i.due_date);
              return (
                <tr key={i.id} className="border-t border-slate-100">
                  <td className="td">{i.inst_no}</td>
                  <td className="td">{dateStr(i.due_date)}</td>
                  <td className="td text-right tabular-nums">{sar(i.amount)}</td>
                  <td className="td text-right tabular-nums">{sar(i.paid_amount)}</td>
                  <td className="td text-right tabular-nums">{sar(Number(i.amount) - Number(i.paid_amount))}</td>
                  <td className="td"><span className={`badge ${INST_STATUS_TONE[s] ?? "bg-slate-100"}`}>{INST_STATUS_LABEL[s] ?? s}</span></td>
                </tr>
              );
            })}
            {installments.length === 0 && <tr><td className="td text-slate-400" colSpan={6}>No installments.</td></tr>}
          </tbody>
        </table>
      </section>

      {canOwnership && contract.status !== "cancelled" && (
        <LifecyclePanel contract={contract} onDone={() => router.refresh()} />
      )}

      {canManage && contract.status !== "cancelled" && (
        <CommissionPanel contractId={contract.id} commission={commission} salePrice={Number(contract.sale_price || 0)} onDone={() => router.refresh()} />
      )}

      {canReceipts && contract.status === "active" && (
        <PaymentPanel contractId={contract.id} installments={installments} onDone={() => router.refresh()} />
      )}

      {/* Receipt history */}
      <section className="card overflow-x-auto p-0">
        <h2 className="px-4 pt-4 font-semibold text-slate-700">Receipts</h2>
        <table className="mt-2 w-full min-w-[640px]">
          <thead className="bg-slate-50"><tr>
            <th className="th">Receipt</th><th className="th">Date</th><th className="th">Method</th>
            <th className="th text-right">Amount</th><th className="th">Allocated To</th>{canReceipts && <th className="th text-right"></th>}
          </tr></thead>
          <tbody>
            {receipts.map((r) => {
              const allocs = (r.car_receipt_allocations ?? []) as any[];
              const to = allocs.map((a) => {
                if (a.target_type === "advance") return "Advance";
                const ins = installments.find((i) => i.id === a.installment_id);
                return ins ? `#${ins.inst_no} (${sar(a.amount)})` : sar(a.amount);
              }).join(", ");
              return (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="td font-medium">{r.receipt_no}</td>
                  <td className="td">{dateStr(r.receipt_date)}</td>
                  <td className="td capitalize">{r.method}</td>
                  <td className="td text-right tabular-nums">{sar(r.amount)}</td>
                  <td className="td text-xs">{to || "—"}</td>
                  {canReceipts && <td className="td text-right"><button className="text-red-500 hover:underline" disabled={busy} onClick={() => call2("car_receipt_delete", { p_id: r.id }, "Delete this receipt?")}>Delete</button></td>}
                </tr>
              );
            })}
            {receipts.length === 0 && <tr><td className="td text-slate-400" colSpan={canReceipts ? 6 : 5}>No receipts yet.</td></tr>}
          </tbody>
        </table>
      </section>

      <p className="text-sm text-slate-400">The Monthly Service Charge, delivery, holding and transfer for this contract will appear here as those steps are added.</p>
    </div>
  );

  async function call2(fn: string, args: any, msg?: string) {
    if (msg && !confirm(msg)) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) return setErr(error.message);
    router.refresh();
  }
}

function LifecyclePanel({ contract, onDone }: { contract: any; onDone: () => void }) {
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [modal, setModal] = useState<null | "deliver" | "hold" | "transfer">(null);
  const [f, setF] = useState<Record<string, string>>({});
  const vs = contract.vehicle?.status as string;
  const owner = contract.vehicle?.ownership as string;
  const vid = contract.vehicle?.id as string;

  async function run(fn: string, args: any) {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) return setErr(error.message);
    setModal(null); setF({}); onDone();
  }

  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold text-slate-700">Vehicle Lifecycle</h2>
        <span className="text-sm text-slate-400">{contract.vehicle ? `${contract.vehicle.plate_no ?? contract.vehicle.vehicle_no}` : ""}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          {vs !== "delivered" && vs !== "held" && <button className="btn-outline text-sm" onClick={() => { setF({ delivery_date: new Date().toISOString().slice(0, 10) }); setModal("deliver"); }}>Deliver</button>}
          {vs !== "held" && owner === "vista" && <button className="btn-outline text-sm text-amber-700" onClick={() => { setF({ held_date: new Date().toISOString().slice(0, 10) }); setModal("hold"); }}>Hold Vehicle</button>}
          {vs === "held" && <button className="btn-outline text-sm" disabled={busy} onClick={() => run("car_vehicle_release", { p_vehicle: vid, p_notes: null })}>Release Hold</button>}
          {owner === "vista" && <button className="btn-outline text-sm" onClick={() => { setF({ transfer_date: new Date().toISOString().slice(0, 10) }); setModal("transfer"); }}>Transfer Out</button>}
          {owner === "transferred" && <span className="badge bg-green-100 text-green-700">Transferred — charges stopped</span>}
        </div>
      </div>
      {err && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setModal(null)}>
          <div className="w-full max-w-md rounded-lg bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-lg font-semibold capitalize">{modal === "deliver" ? "Deliver Vehicle" : modal === "hold" ? "Hold Vehicle" : "Transfer Vehicle Out"}</h3>
            <div className="space-y-3">
              {modal === "deliver" && (<>
                <div><label className="label">Delivery Date</label><input type="date" className="input" value={f.delivery_date ?? ""} onChange={(e) => setF({ ...f, delivery_date: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="label">Odometer</label><input type="number" className="input" value={f.odometer ?? ""} onChange={(e) => setF({ ...f, odometer: e.target.value })} /></div>
                  <div><label className="label">Delivered By</label><input className="input" value={f.delivered_by ?? ""} onChange={(e) => setF({ ...f, delivered_by: e.target.value })} /></div>
                </div>
                <div><label className="label">Customer Acknowledgement</label><input className="input" value={f.acknowledged_by ?? ""} onChange={(e) => setF({ ...f, acknowledged_by: e.target.value })} /></div>
              </>)}
              {modal === "hold" && (<>
                <div><label className="label">Held Date</label><input type="date" className="input" value={f.held_date ?? ""} onChange={(e) => setF({ ...f, held_date: e.target.value })} /></div>
                <div><label className="label">Reason</label><input className="input" value={f.reason ?? ""} onChange={(e) => setF({ ...f, reason: e.target.value })} /></div>
                <div><label className="label">Agreement Notes</label><textarea className="input" rows={2} value={f.agreement_notes ?? ""} onChange={(e) => setF({ ...f, agreement_notes: e.target.value })} /></div>
                <p className="text-xs text-slate-400">Holding does not cancel the contract — the balance and installments stay active.</p>
              </>)}
              {modal === "transfer" && (<>
                <div><label className="label">Transfer Date</label><input type="date" className="input" value={f.transfer_date ?? ""} onChange={(e) => setF({ ...f, transfer_date: e.target.value })} /></div>
                <div><label className="label">Destination / Company</label><input className="input" value={f.destination ?? ""} onChange={(e) => setF({ ...f, destination: e.target.value })} /></div>
                <div><label className="label">Reference</label><input className="input" value={f.reference ?? ""} onChange={(e) => setF({ ...f, reference: e.target.value })} /></div>
                <p className="text-xs text-slate-400">Transferring out of Vista's name stops future Monthly Service Charges. Past charges are kept.</p>
              </>)}
            </div>
            <div className="mt-4 flex gap-2">
              <button className="btn" disabled={busy} onClick={() => {
                if (modal === "deliver") run("car_vehicle_deliver", { p_contract: contract.id, p: f });
                else if (modal === "hold") run("car_vehicle_hold", { p_contract: contract.id, p: f });
                else run("car_vehicle_transfer", { p_vehicle: vid, p: f });
              }}>{busy ? "Saving…" : "Confirm"}</button>
              <button className="btn-outline" onClick={() => setModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function CommissionPanel({ contractId, commission, salePrice, onDone }: { contractId: string; commission: any; salePrice: number; onDone: () => void }) {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({
    reference_name: commission?.reference_name ?? "",
    comm_type: commission?.comm_type ?? "fixed",
    comm_value: commission?.comm_value ?? "",
    paid: commission?.paid ?? false,
    paid_date: commission?.paid_date ?? "",
    notes: commission?.notes ?? "",
  });
  const amount = f.comm_type === "percentage" ? Math.round(salePrice * (Number(f.comm_value) || 0) / 100 * 100) / 100 : (Number(f.comm_value) || 0);

  async function save() {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("car_commission_save", { p_contract: contractId, p: { ...f, comm_value: String(f.comm_value || 0), paid: String(!!f.paid) } });
    setBusy(false);
    if (error) return setErr(error.message);
    setOpen(false); onDone();
  }

  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold text-slate-700">Commission</h2>
        {commission ? <span className="text-sm text-slate-500">{commission.reference_name ?? "—"} · {sar(commission.amount)} · {commission.paid ? "Paid" : "Unpaid"}</span> : <span className="text-sm text-slate-400">None</span>}
        <button className="btn-outline text-sm ml-auto" onClick={() => setOpen((o) => !o)}>{open ? "Close" : commission ? "Edit" : "Add commission"}</button>
      </div>
      {open && (
        <div className="space-y-3">
          {err && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
          <div className="grid gap-3 md:grid-cols-4">
            <div><label className="label">Reference / Introducer</label><input className="input" value={f.reference_name} onChange={(e) => setF({ ...f, reference_name: e.target.value })} /></div>
            <div><label className="label">Type</label><select className="input" value={f.comm_type} onChange={(e) => setF({ ...f, comm_type: e.target.value })}><option value="fixed">Fixed</option><option value="percentage">Percentage</option></select></div>
            <div><label className="label">{f.comm_type === "percentage" ? "Percent (%)" : "Amount (SAR)"}</label><input type="number" step="0.01" className="input" value={f.comm_value} onChange={(e) => setF({ ...f, comm_value: e.target.value })} /></div>
            <div className="flex items-end text-sm">Commission: <b className="ml-1">{sar(amount)}</b></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.paid} onChange={(e) => setF({ ...f, paid: e.target.checked })} /> Paid</label>
            {f.paid && <div><label className="label">Paid Date</label><input type="date" className="input" value={f.paid_date} onChange={(e) => setF({ ...f, paid_date: e.target.value })} /></div>}
            <div className="md:col-span-2"><label className="label">Notes</label><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
          </div>
          <button className="btn" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save commission"}</button>
        </div>
      )}
    </section>
  );
}

function PaymentPanel({ contractId, installments, onDone }: { contractId: string; installments: any[]; onDone: () => void }) {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const unpaid = installments.filter((i) => Number(i.paid_amount || 0) < Number(i.amount || 0));
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const total = Object.values(alloc).reduce((a, v) => a + (Number(v) || 0), 0);

  async function save() {
    const allocs = Object.entries(alloc)
      .filter(([, v]) => Number(v) > 0)
      .map(([installment_id, v]) => ({ target_type: "installment", installment_id, amount: String(v) }));
    if (allocs.length === 0) { setErr("Allocate the payment to at least one installment."); return; }
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("car_receipt_save", {
      p_id: null,
      p_header: { contract_id: contractId, receipt_date: date, amount: String(total), method, reference },
      p_allocs: allocs,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setAlloc({}); setReference(""); setOpen(false); onDone();
  }

  return (
    <section className="card space-y-3 border-l-4 border-emerald-400">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-700">Receive Payment</h2>
        <button className="btn-outline text-sm" onClick={() => setOpen((o) => !o)}>{open ? "Close" : "Record a payment"}</button>
      </div>
      {open && (
        <div className="space-y-3">
          {err && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
          <div className="grid gap-3 md:grid-cols-4">
            <div><label className="label">Date</label><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div><label className="label">Method</label>
              <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="cash">Cash</option><option value="bank">Bank</option><option value="card">Card</option><option value="transfer">Transfer</option>
              </select>
            </div>
            <div className="md:col-span-2"><label className="label">Reference</label><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Cheque / transfer ref" /></div>
          </div>
          <p className="text-xs text-slate-400">Enter the amount against the exact installment(s) being paid — money is not auto-applied to the oldest month.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="th">No.</th><th className="th">Due</th><th className="th text-right">Amount</th><th className="th text-right">Remaining</th><th className="th text-right">Pay Now</th>
              </tr></thead>
              <tbody>
                {unpaid.map((i) => {
                  const rem = Number(i.amount) - Number(i.paid_amount);
                  return (
                    <tr key={i.id} className="border-b border-slate-50">
                      <td className="td">{i.inst_no}</td>
                      <td className="td">{dateStr(i.due_date)}</td>
                      <td className="td text-right tabular-nums">{sar(i.amount)}</td>
                      <td className="td text-right tabular-nums">{sar(rem)}</td>
                      <td className="td text-right">
                        <div className="flex items-center justify-end gap-1">
                          <input type="number" step="0.01" className="input w-28 text-right" value={alloc[i.id] ?? ""} onChange={(e) => setAlloc((s) => ({ ...s, [i.id]: e.target.value }))} />
                          <button type="button" className="text-xs text-brand hover:underline" onClick={() => setAlloc((s) => ({ ...s, [i.id]: String(rem) }))}>full</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {unpaid.length === 0 && <tr><td className="td text-slate-400" colSpan={5}>All installments are paid.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-sm">Receipt total: <b>{sar(total)}</b></div>
            <button className="btn" disabled={busy || total <= 0} onClick={save}>{busy ? "Saving…" : "Save receipt"}</button>
          </div>
        </div>
      )}
    </section>
  );
}
