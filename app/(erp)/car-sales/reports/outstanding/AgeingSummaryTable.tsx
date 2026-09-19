"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import ReportKpi from "@/components/reports/ReportKpi";
import SectionHeader from "@/components/reports/SectionHeader";

const num = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
const drCr = (n: number) => `${num(Math.abs(n))} ${n >= 0 ? "Dr" : "Cr"}`;

const DUE_BG = "bg-amber-50/70";
const RCPT_BG = "bg-emerald-50/70";

export type AgeingRow = {
  id: string; name: string; cars: number;
  due: number; overdue: number; total_due: number; balance: number;
  due_cur: number; due_last: number; due_l2: number; due_l3: number; due_prev: number;
  rcpt_cur: number; rcpt_last: number; rcpt_l2: number; rcpt_l3: number;
};

type Vehicle = {
  contract_id: string; contract_no: string; vehicle: string; plate_no: string | null; status: string;
  installment_due: number; installment_overdue: number; installment_total: number;
  service_charge_due: number; service_charge_overdue: number; service_charge_total: number;
  total_due: number; total_overdue: number; total: number;
};
type VehicleDues = { vehicles: Vehicle[]; other: { due: number; overdue: number; total: number } };

// A customer's own Due/Overdue is a total across whatever they owe on — a
// vehicle's instalments, a month of service charges, or (rarely) something
// billed outside the car module. The chevron drills into
// car_customer_vehicle_dues(), fetched on demand the same way the per-
// customer report's own bill drill-down (CustomerReportClient's
// BillDrilldown) reads journal_lines on click — a report row's own detail,
// not the report's outermost grouping, so it starts collapsed on purpose.
function VehicleDrilldown({ customerId }: { customerId: string }) {
  const [data, setData] = useState<VehicleDues | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sb = createClient();
      const { data: d } = await sb.rpc("car_customer_vehicle_dues", { p_customer_id: customerId });
      if (!cancelled) { setData((d as VehicleDues) ?? { vehicles: [], other: { due: 0, overdue: 0, total: 0 } }); setBusy(false); }
    })();
    return () => { cancelled = true; };
  }, [customerId]);

  if (busy) return <p className="px-3 py-2 text-xs text-slate-400">Loading vehicles…</p>;
  if (!data || (data.vehicles.length === 0 && data.other.total <= 0.005)) {
    return <p className="px-3 py-2 text-xs text-slate-400">No open balance found for this customer.</p>;
  }

  return (
    <table className="report-grid w-full text-xs">
      <thead className="text-slate-500">
        <tr>
          <th className="px-2 py-1 text-left font-semibold uppercase tracking-wide">Vehicle</th>
          <th className="px-2 py-1 text-right font-semibold uppercase tracking-wide">Instalment Due</th>
          <th className="px-2 py-1 text-right font-semibold uppercase tracking-wide">Instalment Overdue</th>
          <th className="px-2 py-1 text-right font-semibold uppercase tracking-wide">Service Charge Due</th>
          <th className="px-2 py-1 text-right font-semibold uppercase tracking-wide">Service Charge Overdue</th>
          <th className="px-2 py-1 text-right font-semibold uppercase tracking-wide">Total Due</th>
          <th className="px-2 py-1 text-right font-semibold uppercase tracking-wide">Total Overdue</th>
        </tr>
      </thead>
      <tbody>
        {data.vehicles.map((v) => (
          <tr key={v.contract_id} className="border-t border-slate-200">
            <td className="px-2 py-1">
              <Link href={`/car-sales/contracts/${v.contract_id}`} className="text-brand hover:underline">{v.contract_no}</Link>
              {v.vehicle || v.plate_no ? <span className="ml-1 text-slate-500">{[v.vehicle, v.plate_no].filter(Boolean).join(" · ")}</span> : null}
            </td>
            <td className="px-2 py-1 text-right tabular-nums">{v.installment_due > 0.005 ? num(v.installment_due) : "—"}</td>
            <td className="px-2 py-1 text-right tabular-nums">{v.installment_overdue > 0.005 ? <span className="text-red-600">{num(v.installment_overdue)}</span> : "—"}</td>
            <td className="px-2 py-1 text-right tabular-nums">{v.service_charge_due > 0.005 ? num(v.service_charge_due) : "—"}</td>
            <td className="px-2 py-1 text-right tabular-nums">{v.service_charge_overdue > 0.005 ? <span className="text-red-600">{num(v.service_charge_overdue)}</span> : "—"}</td>
            <td className="px-2 py-1 text-right tabular-nums font-medium">{num(v.total_due)}</td>
            <td className="px-2 py-1 text-right tabular-nums font-medium">{v.total_overdue > 0.005 ? <span className="text-red-600">{num(v.total_overdue)}</span> : "—"}</td>
          </tr>
        ))}
        {data.other.total > 0.005 && (
          <tr className="border-t border-slate-200">
            <td className="px-2 py-1 text-slate-500">Other</td>
            <td className="px-2 py-1 text-right tabular-nums" colSpan={3}></td>
            <td className="px-2 py-1 text-right tabular-nums">{data.other.due > 0.005 ? num(data.other.due) : "—"}</td>
            <td className="px-2 py-1 text-right tabular-nums font-medium">{num(data.other.due)}</td>
            <td className="px-2 py-1 text-right tabular-nums font-medium">{data.other.overdue > 0.005 ? <span className="text-red-600">{num(data.other.overdue)}</span> : "—"}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

export default function AgeingSummaryTable({ rows, totalCars }: { rows: AgeingRow[]; totalCars: number }) {
  const [open, setOpen] = useState<string | null>(null);

  const sum = (k: string) => rows.reduce((s, r) => s + Number((r as any)[k] || 0), 0);
  const totalBalance = sum("balance");
  const totalDue = sum("due");
  const totalOverdue = sum("overdue");
  const custsWithBalance = rows.filter((r) => r.balance > 0.005).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        <ReportKpi label="Customers" value={String(rows.length)} icon="users" />
        <ReportKpi label="Total Cars" value={String(totalCars)} icon="car" />
        <ReportKpi label="Ledger Balance" value={drCr(totalBalance)} icon="wallet" tone={totalOverdue > 0 ? "neg" : undefined} />
        <ReportKpi label="Due" value={num(totalDue)} icon="clock" tone={totalDue > 0 ? "warn" : undefined} />
        <ReportKpi label="Overdue" value={num(totalOverdue)} icon="clock" tone={totalOverdue > 0 ? "neg" : undefined} />
        <ReportKpi label="Total Dues" value={num(totalDue + totalOverdue)} icon="wallet" tone={totalDue + totalOverdue > 0 ? "warn" : undefined} />
        <ReportKpi label="Customers Owing" value={String(custsWithBalance)} icon="users" />
      </div>
      <div>
        <SectionHeader title={`Customer Due Ageing Summary — Total Cars: ${totalCars}`} />
        <div className="card overflow-x-auto p-0">
          <table className="report-grid w-full min-w-[1150px] text-sm">
            <thead className="bg-brand-50 text-[11px] font-semibold uppercase tracking-wide text-brand-800">
              <tr>
                <th className="px-4 py-2.5 text-right" rowSpan={2}>Sr #</th>
                <th className="px-4 py-2.5 text-left" rowSpan={2}><span className="col-resize">Name</span></th>
                <th className="px-4 py-2.5 text-right" rowSpan={2}><span className="col-resize">Led. Bal</span></th>
                <th className="px-4 py-2.5 text-right" rowSpan={2}><span className="col-resize">Due</span></th>
                <th className="px-4 py-2.5 text-right" rowSpan={2}><span className="col-resize">Overdue</span></th>
                <th className="px-4 py-2.5 text-right" rowSpan={2}><span className="col-resize">Total</span></th>
                <th className={`px-4 py-2.5 text-center border-l border-slate-300 ${DUE_BG}`} colSpan={5}>Monthly Due</th>
                <th className={`px-4 py-2.5 text-center border-l border-slate-300 ${RCPT_BG}`} colSpan={4}>Monthly Receipts</th>
              </tr>
              <tr>
                <th className={`px-2 py-2.5 text-right border-l border-slate-300 ${DUE_BG}`}><span className="col-resize-wrap">Current Month Due</span></th>
                <th className={`px-2 py-2.5 text-right ${DUE_BG}`}><span className="col-resize-wrap">Last Month Due</span></th>
                <th className={`px-2 py-2.5 text-right ${DUE_BG}`}><span className="col-resize-wrap">2nd Last Month Due</span></th>
                <th className={`px-2 py-2.5 text-right ${DUE_BG}`}><span className="col-resize-wrap">3rd Last Month Due</span></th>
                <th className={`px-2 py-2.5 text-right ${DUE_BG}`}><span className="col-resize-wrap">All Previous Dues</span></th>
                <th className={`px-2 py-2.5 text-right border-l border-slate-300 ${RCPT_BG}`}><span className="col-resize-wrap">Current Month Rec</span></th>
                <th className={`px-2 py-2.5 text-right ${RCPT_BG}`}><span className="col-resize-wrap">Last Month Rec</span></th>
                <th className={`px-2 py-2.5 text-right ${RCPT_BG}`}><span className="col-resize-wrap">2nd Last Month Rec</span></th>
                <th className={`px-2 py-2.5 text-right ${RCPT_BG}`}><span className="col-resize-wrap">3rd Last Month Rec</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <>
                  <tr key={r.id} className={`border-t border-slate-100 ${i % 2 === 1 ? "bg-slate-100/80" : ""}`}>
                    <td className="td text-right tabular-nums text-slate-400">{i + 1}</td>
                    <td className="td">
                      <button
                        type="button"
                        onClick={() => setOpen(open === r.id ? null : r.id)}
                        className="mr-1.5 inline-flex h-4 w-4 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                        aria-label={open === r.id ? "Collapse" : "Expand"}
                      >
                        {open === r.id ? "▾" : "›"}
                      </button>
                      <Link href={`/car-sales/customers/${r.id}`} className="text-brand hover:underline">{r.name}</Link>
                    </td>
                    <td className={`td text-right tabular-nums font-medium ${r.overdue > 0.005 ? "text-red-600" : r.balance < -0.005 ? "text-emerald-700" : ""}`}>{drCr(r.balance)}</td>
                    <td className="td text-right tabular-nums">{r.due > 0 ? <span className="text-amber-700">{num(r.due)}</span> : "—"}</td>
                    <td className="td text-right tabular-nums">{r.overdue > 0 ? <span className="text-red-600">{num(r.overdue)}</span> : "—"}</td>
                    <td className="td text-right tabular-nums font-medium">{num(r.total_due)}</td>
                    <td className={`td text-right tabular-nums border-l border-slate-100 ${DUE_BG}`}>{num(r.due_cur)}</td>
                    <td className={`td text-right tabular-nums ${DUE_BG}`}>{num(r.due_last)}</td>
                    <td className={`td text-right tabular-nums ${DUE_BG}`}>{num(r.due_l2)}</td>
                    <td className={`td text-right tabular-nums ${DUE_BG}`}>{num(r.due_l3)}</td>
                    <td className={`td text-right tabular-nums text-red-600 ${DUE_BG}`}>{num(r.due_prev)}</td>
                    <td className={`td text-right tabular-nums text-green-700 border-l border-slate-100 ${RCPT_BG}`}>{num(r.rcpt_cur)}</td>
                    <td className={`td text-right tabular-nums text-green-700 ${RCPT_BG}`}>{num(r.rcpt_last)}</td>
                    <td className={`td text-right tabular-nums text-green-700 ${RCPT_BG}`}>{num(r.rcpt_l2)}</td>
                    <td className={`td text-right tabular-nums text-green-700 ${RCPT_BG}`}>{num(r.rcpt_l3)}</td>
                  </tr>
                  {open === r.id && (
                    <tr key={`${r.id}-drill`} className="border-t border-slate-100 bg-slate-50">
                      <td className="td" />
                      <td className="td p-0" colSpan={14}>
                        <VehicleDrilldown customerId={r.id} />
                      </td>
                    </tr>
                  )}
                </>
              ))}
              {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={15}>No outstanding balances or recent activity.</td></tr>}
            </tbody>
            {rows.length > 0 && <tfoot><tr className="border-t-2 border-slate-200 font-semibold">
              <td className="td" />
              <td className="td">Total ({rows.length})</td>
              <td className={`td text-right tabular-nums ${totalOverdue > 0.005 ? "text-red-600" : totalBalance < -0.005 ? "text-emerald-700" : ""}`}>{drCr(totalBalance)}</td>
              <td className="td text-right tabular-nums">{num(totalDue)}</td>
              <td className="td text-right tabular-nums">{num(totalOverdue)}</td>
              <td className="td text-right tabular-nums">{num(sum("total_due"))}</td>
              <td className={`td text-right tabular-nums border-l border-slate-100 ${DUE_BG}`}>{num(sum("due_cur"))}</td>
              <td className={`td text-right tabular-nums ${DUE_BG}`}>{num(sum("due_last"))}</td>
              <td className={`td text-right tabular-nums ${DUE_BG}`}>{num(sum("due_l2"))}</td>
              <td className={`td text-right tabular-nums ${DUE_BG}`}>{num(sum("due_l3"))}</td>
              <td className={`td text-right tabular-nums ${DUE_BG}`}>{num(sum("due_prev"))}</td>
              <td className={`td text-right tabular-nums border-l border-slate-100 ${RCPT_BG}`}>{num(sum("rcpt_cur"))}</td>
              <td className={`td text-right tabular-nums ${RCPT_BG}`}>{num(sum("rcpt_last"))}</td>
              <td className={`td text-right tabular-nums ${RCPT_BG}`}>{num(sum("rcpt_l2"))}</td>
              <td className={`td text-right tabular-nums ${RCPT_BG}`}>{num(sum("rcpt_l3"))}</td>
            </tr></tfoot>}
          </table>
        </div>
      </div>
    </div>
  );
}
