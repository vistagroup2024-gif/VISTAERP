import { Fragment } from "react";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import SectionHeader from "@/components/reports/SectionHeader";
import ReportKpi from "@/components/reports/ReportKpi";
import { COMPANY_ID, monthShort } from "@/lib/format";
import AgeingSummaryTable, { type AgeingRow } from "./AgeingSummaryTable";

// A plain number, no currency code — every figure on this screen is SAR, so
// repeating "SAR" on all 14 columns of every row is noise the column headers
// already make redundant.
const num = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
// A ledger balance in the accounting sense — signed Debit/Credit, not just a
// number — the same "Dr"/"Cr" suffix the old software's own report carried.
const drCr = (n: number) => `${num(Math.abs(n))} ${n >= 0 ? "Dr" : "Cr"}`;
// Monthly Due and Monthly Receipts read as two distinct blocks (their own
// tint, not the old software's exact blue/yellow) so the eye separates
// "what's owed" from "what came in" without reading every header.
const DUE_BG = "bg-amber-50/70";
const RCPT_BG = "bg-emerald-50/70";
const BAL_BG = "bg-slate-50";

export const dynamic = "force-dynamic";

type MatrixRow = { customer_id: string; name: string; month: string; billed: number; outstanding: number; receipts: number; receiptsByBill: number };

// This is the dashboard's Car Customer Balances card, per customer instead of
// summed. car_customer_balances() is car_money's (dashboard_metrics()) own
// per-customer breakdown — same three sources (instalments, the invoice
// advance, the monthly service charge), same disjoint Due/Overdue split, same
// ledger balance — so a row here always foots to what the card shows.
// Building this report's own totals from car_installments alone, the way it
// did before, is what let it disagree with the card in the first place.
//
// FIVE TABS: Customer Due Ageing Summary (default — one row per customer,
// combining car_customer_balances()'s "what is owed right now" with
// car_customer_monthwise()'s "what was due and collected, month by month" —
// both read the same three due-date sources, so merging them client-side
// (no new RPC) never tells two different stories about the same customer),
// Installment Aging (moved in from its own former screen — one row per
// CONTRACT instead of per customer, car_installment_aging()), Monthly
// Balances, Receipts Monthwise and Billed vs Receipts Monthwise — the
// latter three all pivoted client-side off the ONE flat
// car_customer_monthly_matrix() RPC (migration 449), so they can never
// disagree with each other about what a given customer's given month holds.
//
// Follow-up Date is not a column here: nothing in the schema records a
// follow-up/next-contact date against a car customer, contract or
// installment (checked car_contracts, car_installments, car_receipts,
// parties — none carry it). Inventing one was explicitly ruled out; see the
// Phase 5 report to the user for what adding it would require.
export default async function OutstandingReport({ searchParams }: { searchParams: { tab?: string } }) {
  await guardStaffPage("carsales.reports");
  const supabase = createClient();
  const tab = ["monthly", "receipts", "billed", "installments"].includes(searchParams.tab ?? "")
    ? (searchParams.tab as "monthly" | "receipts" | "billed" | "installments") : "ageing";

  const TABS: [string, string][] = [
    ["ageing", "Customer Due Ageing Summary"],
    ["installments", "Installment Aging"],
    ["monthly", "Monthly Balances"],
    ["receipts", "Receipts Monthwise"],
    ["billed", "Billed vs Receipts Monthwise"],
  ];

  let matrixRows: MatrixRow[] = [];
  if (tab === "monthly" || tab === "receipts" || tab === "billed") {
    const { data } = await supabase.rpc("car_customer_monthly_matrix", { p_company: COMPANY_ID });
    matrixRows = ((data ?? []) as any[]).map((r) => ({
      customer_id: r.customer_id, name: r.name ?? "—", month: String(r.month).slice(0, 7),
      billed: Number(r.billed || 0), outstanding: Number(r.outstanding || 0), receipts: Number(r.receipts || 0),
      receiptsByBill: Number(r.receipts_by_bill || 0),
    }));
  }
  let instRows: InstallmentAgingRow[] = [];
  if (tab === "installments") {
    const { data } = await supabase.rpc("car_installment_aging");
    instRows = ((data ?? []) as any[]).map((r) => ({
      id: r.id, contract_no: r.contract_no, customer: r.customer ?? "—",
      current: Number(r.current || 0), d30: Number(r.d30 || 0), d60: Number(r.d60 || 0),
      d90: Number(r.d90 || 0), d90p: Number(r.d90p || 0), total: Number(r.total || 0),
    }));
  }

  return (
    <div>
      <PageHeader title="Car Customer Balances">
        <PrintButton />
      </PageHeader>
      <div className="mb-4 flex flex-wrap gap-2 print:hidden">
        {TABS.map(([k, l]) => (
          <Link key={k} href={`/car-sales/reports/outstanding?tab=${k}`}
            className={`rounded-full px-3 py-1 text-sm ${tab === k ? "bg-brand text-white" : "bg-slate-100 text-slate-600"}`}>{l}</Link>
        ))}
      </div>
      {tab === "ageing" ? await AgeingSummary(supabase)
        : tab === "installments" ? <InstallmentAging rows={instRows} />
        : tab === "monthly" ? <MonthlyBalances rows={matrixRows} />
        : tab === "receipts" ? <ReceiptsMonthwise rows={matrixRows} />
        : <BilledVsReceipts rows={matrixRows} />}
    </div>
  );
}

// Moved in from the standalone Installment Aging report (car_installment_aging(),
// migration 430) — same per-contract bucketing (current/1-30/31-60/61-90/90+),
// the same three due-date sources (installments, the invoice advance, monthly
// service charges) car_customer_balances() and dashboard_metrics() already use,
// so this tab never disagrees with the Ageing Summary tab beside it.
type InstallmentAgingRow = {
  id: string; contract_no: string; customer: string;
  current: number; d30: number; d60: number; d90: number; d90p: number; total: number;
};
function InstallmentAging({ rows }: { rows: InstallmentAgingRow[] }) {
  const t = rows.reduce((a, r) => ({
    current: a.current + r.current, d30: a.d30 + r.d30, d60: a.d60 + r.d60,
    d90: a.d90 + r.d90, d90p: a.d90p + r.d90p, total: a.total + r.total,
  }), { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0, total: 0 });

  return (
    <div className="card overflow-x-auto p-0">
      <table className="report-grid w-full min-w-[820px]">
        <thead className="bg-brand-50 text-[11px] font-semibold uppercase tracking-wide text-brand-800"><tr>
          <th className="px-4 py-2.5 text-left"><span className="col-resize">Contract</span></th><th className="px-4 py-2.5 text-left"><span className="col-resize">Customer</span></th>
          <th className="px-4 py-2.5 text-right"><span className="col-resize">Current</span></th><th className="px-4 py-2.5 text-right"><span className="col-resize">1-30</span></th><th className="px-4 py-2.5 text-right"><span className="col-resize">31-60</span></th>
          <th className="px-4 py-2.5 text-right"><span className="col-resize">61-90</span></th><th className="px-4 py-2.5 text-right"><span className="col-resize">90+</span></th><th className="px-4 py-2.5 text-right"><span className="col-resize">Total</span></th>
        </tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className={`border-t border-slate-100 ${i % 2 === 1 ? "bg-slate-100/80" : ""}`}>
              <td className="td"><Link href={`/car-sales/contracts/${r.id}`} className="text-brand hover:underline">{r.contract_no}</Link></td>
              <td className="td">{r.customer}</td>
              <td className="td text-right tabular-nums">{num(r.current)}</td>
              <td className="td text-right tabular-nums">{num(r.d30)}</td>
              <td className="td text-right tabular-nums">{num(r.d60)}</td>
              <td className="td text-right tabular-nums">{num(r.d90)}</td>
              <td className="td text-right tabular-nums text-red-600">{num(r.d90p)}</td>
              <td className="td text-right tabular-nums font-medium">{num(r.total)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={8}>Nothing outstanding.</td></tr>}
        </tbody>
        {rows.length > 0 && <tfoot><tr className="border-t-2 border-slate-400 bg-slate-200 font-bold">
          <td className="td" colSpan={2}>Total</td>
          <td className="td text-right tabular-nums">{num(t.current)}</td><td className="td text-right tabular-nums">{num(t.d30)}</td>
          <td className="td text-right tabular-nums">{num(t.d60)}</td><td className="td text-right tabular-nums">{num(t.d90)}</td>
          <td className="td text-right tabular-nums">{num(t.d90p)}</td><td className="td text-right tabular-nums">{num(t.total)}</td>
        </tr></tfoot>}
      </table>
    </div>
  );
}

async function AgeingSummary(supabase: ReturnType<typeof createClient>) {
  const [{ data }, { data: monthly }] = await Promise.all([
    supabase.rpc("car_customer_balances"),
    supabase.rpc("car_customer_monthwise", { p_company: COMPANY_ID }),
  ]);
  const monthlyById = new Map(((monthly ?? []) as any[]).map((m) => [m.customer_id, m]));

  const rows: AgeingRow[] = ((data ?? []) as any[]).map((r) => {
    const m = monthlyById.get(r.customer_id);
    monthlyById.delete(r.customer_id);
    return {
      id: r.customer_id, name: r.name ?? "—", cars: Number(r.cars || 0),
      due: Number(r.due || 0), overdue: Number(r.overdue || 0), total_due: Number(r.total_due || 0),
      balance: Number(r.balance || 0),
      due_cur: Number(m?.due_cur || 0), due_last: Number(m?.due_last || 0), due_l2: Number(m?.due_l2 || 0),
      due_l3: Number(m?.due_l3 || 0), due_prev: Number(m?.due_prev || 0),
      rcpt_cur: Number(m?.rcpt_cur || 0), rcpt_last: Number(m?.rcpt_last || 0), rcpt_l2: Number(m?.rcpt_l2 || 0), rcpt_l3: Number(m?.rcpt_l3 || 0),
    };
  })
    // A customer whose only contract is cancelled has no row in
    // car_customer_balances() (it excludes cancelled) but can still have a
    // monthwise row (which doesn't filter status) — carry those in too, so
    // this merged view never drops activity the Monthly Balances tab shows.
    .concat(Array.from(monthlyById.values()).map((m: any) => ({
      id: m.customer_id, name: m.name ?? "—", cars: 0,
      due: 0, overdue: 0, total_due: 0, balance: 0,
      due_cur: Number(m.due_cur || 0), due_last: Number(m.due_last || 0), due_l2: Number(m.due_l2 || 0),
      due_l3: Number(m.due_l3 || 0), due_prev: Number(m.due_prev || 0),
      rcpt_cur: Number(m.rcpt_cur || 0), rcpt_last: Number(m.rcpt_last || 0), rcpt_l2: Number(m.rcpt_l2 || 0), rcpt_l3: Number(m.rcpt_l3 || 0),
    })))
    .filter((r) =>
      Math.abs(r.balance) > 0.005 || r.total_due > 0.005 ||
      [r.due_cur, r.due_last, r.due_l2, r.due_l3, r.due_prev, r.rcpt_cur, r.rcpt_last, r.rcpt_l2, r.rcpt_l3].some((v) => Math.abs(v) > 0.005));

  const totalCars = rows.reduce((s, r) => s + r.cars, 0);

  return <AgeingSummaryTable rows={rows} totalCars={totalCars} />;
}

// Every month that carries ANY billed or received activity, across every
// customer — sorted ascending. Deliberately uncapped (no PeriodDropdown):
// this is a customer's whole schedule/history, the same "not capped to ±3
// months" choice car_customer_report() already makes for one customer, here
// for all of them at once — so the table is as wide as the real data is,
// nothing padded or truncated.
function monthsAxis(rows: MatrixRow[]): string[] {
  return Array.from(new Set(rows.map((r) => r.month))).sort();
}
type CustRow = {
  id: string; name: string;
  byMonth: Map<string, { billed: number; outstanding: number; receipts: number; receiptsByBill: number }>;
  totalBilled: number; totalOutstanding: number; totalReceipts: number; totalReceiptsByBill: number;
};
function pivotByCustomer(rows: MatrixRow[]): CustRow[] {
  const m = new Map<string, CustRow>();
  for (const r of rows) {
    let c = m.get(r.customer_id);
    if (!c) { c = { id: r.customer_id, name: r.name, byMonth: new Map(), totalBilled: 0, totalOutstanding: 0, totalReceipts: 0, totalReceiptsByBill: 0 }; m.set(r.customer_id, c); }
    c.byMonth.set(r.month, { billed: r.billed, outstanding: r.outstanding, receipts: r.receipts, receiptsByBill: r.receiptsByBill });
    c.totalBilled += r.billed;
    c.totalOutstanding += r.outstanding;
    c.totalReceipts += r.receipts;
    c.totalReceiptsByBill += r.receiptsByBill;
  }
  return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name));
}
const thisMonthKey = new Date().toISOString().slice(0, 7);

// "Due" here is what's genuinely still owed for that month — car_customer_
// monthly_matrix()'s own 'outstanding' (456), the same open_items-sourced
// figure car_customer_balances()/the vehicle drilldown already read — not
// 'billed' (the original scheduled amount, never netted against payment).
// Billed vs Receipts Monthwise, below, still reads 'billed' on purpose: that
// tab is explicitly comparing the original schedule against what came in, a
// different, legitimate question from "what's still due."
function MonthlyBalances({ rows }: { rows: MatrixRow[] }) {
  const months = monthsAxis(rows);
  const custs = pivotByCustomer(rows).filter((c) => c.totalOutstanding > 0.005);
  const totalBilled = custs.reduce((s, c) => s + c.totalOutstanding, 0);
  const curMonthDue = rows.filter((r) => r.month === thisMonthKey).reduce((s, r) => s + r.outstanding, 0);
  // Overdue here is the same bucket Ageing Summary's own KPI row uses — every
  // month whose own period has already ended, still carrying a balance —
  // read off the same period-shifted 'outstanding' column Due already reads.
  const overdueMonthly = rows.filter((r) => r.month < thisMonthKey).reduce((s, r) => s + r.outstanding, 0);
  const totalDueMonthly = curMonthDue + overdueMonthly;
  const monthTotal = (mk: string) => custs.reduce((s, c) => s + (c.byMonth.get(mk)?.outstanding ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <ReportKpi label="Customers with a Balance" value={String(custs.length)} icon="users" />
        <ReportKpi label="Total Billed (all months)" value={num(totalBilled)} icon="wallet" tone={totalBilled > 0 ? "warn" : undefined} />
        <ReportKpi label={`Due — ${monthShort(thisMonthKey)}`} value={num(curMonthDue)} icon="clock" tone={curMonthDue > 0 ? "warn" : undefined} />
        <ReportKpi label="Overdue" value={num(overdueMonthly)} icon="clock" tone={overdueMonthly > 0 ? "neg" : undefined} />
        <ReportKpi label="Total Due" value={num(totalDueMonthly)} icon="wallet" tone={totalDueMonthly > 0 ? "warn" : undefined} />
      </div>
      <div>
        <SectionHeader title="Balances Monthwise" />
        <div className="card overflow-x-auto p-0">
          <table className="report-grid w-full text-sm">
            <thead className="bg-brand-50 text-[11px] font-semibold uppercase tracking-wide text-brand-800">
              <tr>
                <th className="px-4 py-2.5 text-left sticky left-0 bg-brand-50 z-10"><span className="col-resize">Customer Name</span></th>
                {months.map((mk) => <th key={mk} className="px-3 py-2.5 text-right"><span className="col-resize">{monthShort(mk)}</span></th>)}
                <th className="px-3 py-2.5 text-right border-l border-slate-300"><span className="col-resize">Total</span></th>
              </tr>
            </thead>
            <tbody>
              {custs.map((c, i) => (
                <tr key={c.id} className={`border-t border-slate-100 ${i % 2 === 1 ? "bg-slate-100/80" : ""}`}>
                  <td className="td sticky left-0 z-10" style={{ background: i % 2 === 1 ? "#f1f5f9" : "#fff" }}>
                    <Link href={`/car-sales/customers/${c.id}`} className="text-brand hover:underline">{c.name}</Link>
                  </td>
                  {months.map((mk) => {
                    const v = c.byMonth.get(mk)?.outstanding ?? 0;
                    return <td key={mk} className="td text-right tabular-nums">{v > 0.005 ? num(v) : ""}</td>;
                  })}
                  <td className="td text-right tabular-nums font-semibold border-l border-slate-100">{num(c.totalOutstanding)}</td>
                </tr>
              ))}
              {custs.length === 0 && <tr><td className="td text-slate-400" colSpan={months.length + 2}>No due schedule found.</td></tr>}
            </tbody>
            {custs.length > 0 && <tfoot><tr className="border-t-2 border-slate-400 bg-slate-200 font-bold">
              <td className="td sticky left-0 bg-slate-200 z-10">Total ({custs.length})</td>
              {months.map((mk) => <td key={mk} className="td text-right tabular-nums">{num(monthTotal(mk))}</td>)}
              <td className="td text-right tabular-nums border-l border-slate-100">{num(totalBilled)}</td>
            </tr></tfoot>}
          </table>
        </div>
      </div>
    </div>
  );
}

function ReceiptsMonthwise({ rows }: { rows: MatrixRow[] }) {
  const months = monthsAxis(rows);
  const custs = pivotByCustomer(rows).filter((c) => c.totalReceipts > 0.005);
  const totalReceipts = custs.reduce((s, c) => s + c.totalReceipts, 0);
  const curMonthRcpt = rows.filter((r) => r.month === thisMonthKey).reduce((s, r) => s + r.receipts, 0);
  const ytdRcpt = rows.filter((r) => r.month >= `${thisMonthKey.slice(0, 4)}-01`).reduce((s, r) => s + r.receipts, 0);
  const monthTotal = (mk: string) => custs.reduce((s, c) => s + (c.byMonth.get(mk)?.receipts ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ReportKpi label="Customers who Paid" value={String(custs.length)} icon="users" />
        <ReportKpi label="Total Receipts (all months)" value={num(totalReceipts)} icon="wallet" tone="pos" />
        <ReportKpi label={`Receipts — ${monthShort(thisMonthKey)}`} value={num(curMonthRcpt)} icon="receipt" tone="pos" />
        <ReportKpi label="Receipts — Year to Date" value={num(ytdRcpt)} icon="receipt" tone="pos" />
      </div>
      <div>
        <SectionHeader title="Receipts Monthwise" />
        <div className="card overflow-x-auto p-0">
          <table className="report-grid w-full text-sm">
            <thead className="bg-brand-50 text-[11px] font-semibold uppercase tracking-wide text-brand-800">
              <tr>
                <th className="px-4 py-2.5 text-left sticky left-0 bg-brand-50 z-10"><span className="col-resize">Group / Customer Name</span></th>
                {months.map((mk) => <th key={mk} className="px-3 py-2.5 text-right"><span className="col-resize">{monthShort(mk)}</span></th>)}
                <th className="px-3 py-2.5 text-right border-l border-slate-300"><span className="col-resize">Total</span></th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-slate-200 bg-brand-50/70 font-bold">
                <td className="td sticky left-0 z-10 bg-brand-50/70">VISTA CAR CUSTOMERS</td>
                {months.map((mk) => <td key={mk} className="td text-right tabular-nums">{num(monthTotal(mk))}</td>)}
                <td className="td text-right tabular-nums border-l border-slate-100">{num(totalReceipts)}</td>
              </tr>
              {custs.map((c, i) => (
                <tr key={c.id} className={`border-t border-slate-100 ${i % 2 === 1 ? "bg-slate-100/80" : ""}`}>
                  <td className="td sticky left-0 z-10 pl-6" style={{ background: i % 2 === 1 ? "#f1f5f9" : "#fff" }}>
                    <Link href={`/car-sales/customers/${c.id}`} className="text-brand hover:underline">{c.name}</Link>
                  </td>
                  {months.map((mk) => {
                    const v = c.byMonth.get(mk)?.receipts ?? 0;
                    return <td key={mk} className="td text-right tabular-nums text-green-700">{v > 0.005 ? num(v) : ""}</td>;
                  })}
                  <td className="td text-right tabular-nums font-semibold border-l border-slate-100">{num(c.totalReceipts)}</td>
                </tr>
              ))}
              {custs.length === 0 && <tr><td className="td text-slate-400" colSpan={months.length + 2}>No receipts recorded.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Receipts here are attributed to the BILL's own month, not the calendar
// month the cash posted in (byMonth's own 'receiptsByBill', 457) — this
// tab is a collection-performance view ("how much of August's bill has
// been collected"), a different question from Receipts Monthwise's plain
// cash-by-month view, which correctly keeps reading the unshifted figure.
function BilledVsReceipts({ rows }: { rows: MatrixRow[] }) {
  const months = monthsAxis(rows);
  const custs = pivotByCustomer(rows).filter((c) => c.totalBilled > 0.005 || c.totalReceiptsByBill > 0.005);
  const totalBilled = custs.reduce((s, c) => s + c.totalBilled, 0);
  const totalReceipts = custs.reduce((s, c) => s + c.totalReceiptsByBill, 0);
  const totalBalance = totalBilled - totalReceipts;
  const collectionPct = totalBilled > 0 ? (totalReceipts / totalBilled) * 100 : null;
  const monthTotal = (mk: string, key: "billed" | "receiptsByBill") => custs.reduce((s, c) => s + (c.byMonth.get(mk)?.[key] ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ReportKpi label="Total Billed" value={num(totalBilled)} icon="wallet" />
        <ReportKpi label="Total Receipts" value={num(totalReceipts)} icon="receipt" tone="pos" />
        <ReportKpi label="Balance (Billed − Receipts)" value={num(totalBalance)} icon="clock" tone={totalBalance > 0 ? "warn" : undefined} />
        <ReportKpi label="Collection %" value={collectionPct === null ? "—" : `${collectionPct.toFixed(1)}%`} icon="trendUp" tone={collectionPct !== null ? (collectionPct >= 95 ? "pos" : "warn") : undefined} />
      </div>
      <div>
        <SectionHeader title="Billed vs Receipts Monthwise" />
        <div className="card overflow-x-auto p-0">
          <table className="report-grid w-full text-sm">
            <thead className="bg-brand-50 text-[11px] font-semibold uppercase tracking-wide text-brand-800">
              <tr>
                <th className="px-4 py-2.5 text-left sticky left-0 bg-brand-50 z-10" rowSpan={2}><span className="col-resize">Customer Name</span></th>
                {months.map((mk) => <th key={mk} className="px-2 py-2 text-center border-l border-slate-300" colSpan={3}><span className="col-resize">{monthShort(mk)}</span></th>)}
              </tr>
              <tr>
                {months.map((mk) => (
                  <Fragment key={mk}>
                    <th className={`px-2 py-2 text-right border-l border-slate-300 ${DUE_BG}`}>Billed</th>
                    <th className={`px-2 py-2 text-right ${RCPT_BG}`}>Receipts</th>
                    <th className={`px-2 py-2 text-right ${BAL_BG}`}>Balance</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {custs.map((c, i) => (
                <tr key={c.id} className={`border-t border-slate-100 ${i % 2 === 1 ? "bg-slate-100/80" : ""}`}>
                  <td className="td sticky left-0 z-10" style={{ background: i % 2 === 1 ? "#f1f5f9" : "#fff" }}>
                    <Link href={`/car-sales/customers/${c.id}`} className="text-brand hover:underline">{c.name}</Link>
                  </td>
                  {months.map((mk) => {
                    const billed = c.byMonth.get(mk)?.billed ?? 0;
                    const receipts = c.byMonth.get(mk)?.receiptsByBill ?? 0;
                    const balance = billed - receipts;
                    return (
                      <Fragment key={mk}>
                        <td className={`td text-right tabular-nums border-l border-slate-100 ${DUE_BG}`}>{billed > 0.005 ? num(billed) : ""}</td>
                        <td className={`td text-right tabular-nums text-green-700 ${RCPT_BG}`}>{receipts > 0.005 ? num(receipts) : ""}</td>
                        <td className={`td text-right tabular-nums ${BAL_BG} ${balance > 0.005 ? "text-amber-700" : balance < -0.005 ? "text-emerald-700" : ""}`}>{Math.abs(balance) > 0.005 ? num(balance) : "0"}</td>
                      </Fragment>
                    );
                  })}
                </tr>
              ))}
              {custs.length === 0 && <tr><td className="td text-slate-400" colSpan={months.length * 3 + 1}>No activity found.</td></tr>}
            </tbody>
            {custs.length > 0 && <tfoot><tr className="border-t-2 border-slate-400 bg-slate-200 font-bold">
              <td className="td sticky left-0 bg-slate-200 z-10">Total ({custs.length})</td>
              {months.map((mk) => {
                const b = monthTotal(mk, "billed"), r = monthTotal(mk, "receiptsByBill");
                return (
                  <Fragment key={mk}>
                    <td className={`td text-right tabular-nums border-l border-slate-100 ${DUE_BG}`}>{num(b)}</td>
                    <td className={`td text-right tabular-nums ${RCPT_BG}`}>{num(r)}</td>
                    <td className={`td text-right tabular-nums ${BAL_BG}`}>{num(b - r)}</td>
                  </Fragment>
                );
              })}
            </tr></tfoot>}
          </table>
        </div>
      </div>
    </div>
  );
}
