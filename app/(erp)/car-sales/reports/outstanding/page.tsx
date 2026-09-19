import { Fragment } from "react";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import SectionHeader from "@/components/reports/SectionHeader";
import ReportKpi from "@/components/reports/ReportKpi";
import { COMPANY_ID, monthShort } from "@/lib/format";

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

type MatrixRow = { customer_id: string; name: string; month: string; billed: number; receipts: number };

// This is the dashboard's Car Customer Balances card, per customer instead of
// summed. car_customer_balances() is car_money's (dashboard_metrics()) own
// per-customer breakdown — same three sources (instalments, the invoice
// advance, the monthly service charge), same disjoint Due/Overdue split, same
// ledger balance — so a row here always foots to what the card shows.
// Building this report's own totals from car_installments alone, the way it
// did before, is what let it disagree with the card in the first place.
//
// FOUR TABS: Customer Due Ageing Summary (default — one row per customer,
// combining car_customer_balances()'s "what is owed right now" with
// car_customer_monthwise()'s "what was due and collected, month by month" —
// both read the same three due-date sources, so merging them client-side
// (no new RPC) never tells two different stories about the same customer),
// Monthly Balances, Receipts Monthwise and Billed vs Receipts Monthwise —
// the latter three all pivoted client-side off the ONE flat
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
  const tab = ["monthly", "receipts", "billed"].includes(searchParams.tab ?? "") ? (searchParams.tab as "monthly" | "receipts" | "billed") : "ageing";

  const TABS: [string, string][] = [
    ["ageing", "Customer Due Ageing Summary"],
    ["monthly", "Monthly Balances"],
    ["receipts", "Receipts Monthwise"],
    ["billed", "Billed vs Receipts Monthwise"],
  ];

  let matrixRows: MatrixRow[] = [];
  if (tab !== "ageing") {
    const { data } = await supabase.rpc("car_customer_monthly_matrix", { p_company: COMPANY_ID });
    matrixRows = ((data ?? []) as any[]).map((r) => ({
      customer_id: r.customer_id, name: r.name ?? "—", month: String(r.month).slice(0, 7),
      billed: Number(r.billed || 0), receipts: Number(r.receipts || 0),
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
        : tab === "monthly" ? <MonthlyBalances rows={matrixRows} />
        : tab === "receipts" ? <ReceiptsMonthwise rows={matrixRows} />
        : <BilledVsReceipts rows={matrixRows} />}
    </div>
  );
}

async function AgeingSummary(supabase: ReturnType<typeof createClient>) {
  const [{ data }, { data: monthly }] = await Promise.all([
    supabase.rpc("car_customer_balances"),
    supabase.rpc("car_customer_monthwise", { p_company: COMPANY_ID }),
  ]);
  const monthlyById = new Map(((monthly ?? []) as any[]).map((m) => [m.customer_id, m]));

  const rows = ((data ?? []) as any[]).map((r) => {
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

  const sum = (k: string) => rows.reduce((s, r) => s + Number((r as any)[k] || 0), 0);
  const totalCars = rows.reduce((s, r) => s + r.cars, 0);
  const totalBalance = sum("balance");
  const custsWithBalance = rows.filter((r) => r.balance > 0.005).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <ReportKpi label="Customers" value={String(rows.length)} icon="users" />
        <ReportKpi label="Total Cars" value={String(totalCars)} icon="car" />
        <ReportKpi label="Ledger Balance" value={drCr(totalBalance)} icon="wallet" tone={totalBalance > 0 ? "neg" : undefined} />
        <ReportKpi label="Total Due" value={num(sum("due"))} icon="clock" tone={sum("due") > 0 ? "warn" : undefined} />
        <ReportKpi label="Total Overdue" value={num(sum("overdue"))} icon="clock" tone={sum("overdue") > 0 ? "neg" : undefined} />
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
                <tr key={r.id} className={`border-t border-slate-100 ${i % 2 === 1 ? "bg-slate-100/80" : ""}`}>
                  <td className="td text-right tabular-nums text-slate-400">{i + 1}</td>
                  <td className="td"><Link href={`/car-sales/customers/${r.id}`} className="text-brand hover:underline">{r.name}</Link></td>
                  <td className={`td text-right tabular-nums font-medium ${r.balance > 0 ? "text-red-600" : r.balance < 0 ? "text-emerald-700" : ""}`}>{drCr(r.balance)}</td>
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
              ))}
              {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={15}>No outstanding balances or recent activity.</td></tr>}
            </tbody>
            {rows.length > 0 && <tfoot><tr className="border-t-2 border-slate-200 font-semibold">
              <td className="td" />
              <td className="td">Total ({rows.length})</td>
              <td className={`td text-right tabular-nums ${sum("balance") > 0 ? "text-red-600" : sum("balance") < 0 ? "text-emerald-700" : ""}`}>{drCr(sum("balance"))}</td>
              <td className="td text-right tabular-nums">{num(sum("due"))}</td>
              <td className="td text-right tabular-nums">{num(sum("overdue"))}</td>
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

// Every month that carries ANY billed or received activity, across every
// customer — sorted ascending. Deliberately uncapped (no PeriodDropdown):
// this is a customer's whole schedule/history, the same "not capped to ±3
// months" choice car_customer_report() already makes for one customer, here
// for all of them at once — so the table is as wide as the real data is,
// nothing padded or truncated.
function monthsAxis(rows: MatrixRow[]): string[] {
  return Array.from(new Set(rows.map((r) => r.month))).sort();
}
type CustRow = { id: string; name: string; byMonth: Map<string, { billed: number; receipts: number }>; totalBilled: number; totalReceipts: number };
function pivotByCustomer(rows: MatrixRow[]): CustRow[] {
  const m = new Map<string, CustRow>();
  for (const r of rows) {
    let c = m.get(r.customer_id);
    if (!c) { c = { id: r.customer_id, name: r.name, byMonth: new Map(), totalBilled: 0, totalReceipts: 0 }; m.set(r.customer_id, c); }
    c.byMonth.set(r.month, { billed: r.billed, receipts: r.receipts });
    c.totalBilled += r.billed;
    c.totalReceipts += r.receipts;
  }
  return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name));
}
const thisMonthKey = new Date().toISOString().slice(0, 7);

function MonthlyBalances({ rows }: { rows: MatrixRow[] }) {
  const months = monthsAxis(rows);
  const custs = pivotByCustomer(rows).filter((c) => c.totalBilled > 0.005);
  const totalBilled = custs.reduce((s, c) => s + c.totalBilled, 0);
  const curMonthBilled = rows.filter((r) => r.month === thisMonthKey).reduce((s, r) => s + r.billed, 0);
  const monthTotal = (mk: string) => custs.reduce((s, c) => s + (c.byMonth.get(mk)?.billed ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ReportKpi label="Customers with a Schedule" value={String(custs.length)} icon="users" />
        <ReportKpi label="Total Billed (all months)" value={num(totalBilled)} icon="wallet" />
        <ReportKpi label={`Billed — ${monthShort(thisMonthKey)}`} value={num(curMonthBilled)} icon="clock" tone={curMonthBilled > 0 ? "warn" : undefined} />
        <ReportKpi label="Months Shown" value={String(months.length)} icon="trendUp" />
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
                    const v = c.byMonth.get(mk)?.billed ?? 0;
                    return <td key={mk} className="td text-right tabular-nums">{v > 0.005 ? num(v) : ""}</td>;
                  })}
                  <td className="td text-right tabular-nums font-semibold border-l border-slate-100">{num(c.totalBilled)}</td>
                </tr>
              ))}
              {custs.length === 0 && <tr><td className="td text-slate-400" colSpan={months.length + 2}>No billed schedule found.</td></tr>}
            </tbody>
            {custs.length > 0 && <tfoot><tr className="border-t-2 border-slate-200 font-semibold">
              <td className="td sticky left-0 bg-slate-50 z-10">Total ({custs.length})</td>
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

function BilledVsReceipts({ rows }: { rows: MatrixRow[] }) {
  const months = monthsAxis(rows);
  const custs = pivotByCustomer(rows).filter((c) => c.totalBilled > 0.005 || c.totalReceipts > 0.005);
  const totalBilled = custs.reduce((s, c) => s + c.totalBilled, 0);
  const totalReceipts = custs.reduce((s, c) => s + c.totalReceipts, 0);
  const totalBalance = totalBilled - totalReceipts;
  const collectionPct = totalBilled > 0 ? (totalReceipts / totalBilled) * 100 : null;
  const monthTotal = (mk: string, key: "billed" | "receipts") => custs.reduce((s, c) => s + (c.byMonth.get(mk)?.[key] ?? 0), 0);

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
                    const receipts = c.byMonth.get(mk)?.receipts ?? 0;
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
            {custs.length > 0 && <tfoot><tr className="border-t-2 border-slate-200 font-semibold">
              <td className="td sticky left-0 bg-slate-50 z-10">Total ({custs.length})</td>
              {months.map((mk) => {
                const b = monthTotal(mk, "billed"), r = monthTotal(mk, "receipts");
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
