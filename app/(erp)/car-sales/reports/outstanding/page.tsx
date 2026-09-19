import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import SectionHeader from "@/components/reports/SectionHeader";
import { COMPANY_ID } from "@/lib/format";

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

export const dynamic = "force-dynamic";

// This is the dashboard's Car Customer Balances card, per customer instead of
// summed. car_customer_balances() is car_money's (dashboard_metrics()) own
// per-customer breakdown — same three sources (instalments, the invoice
// advance, the monthly service charge), same disjoint Due/Overdue split, same
// ledger balance — so a row here always foots to what the card shows.
// Building this report's own totals from car_installments alone, the way it
// did before, is what let it disagree with the card in the first place.
//
// TWO TABS: Customer Due Ageing Summary (default — one row per customer,
// combining car_customer_balances()'s "what is owed right now" with
// car_customer_monthwise()'s "what was due and collected, month by month" —
// both read the same three due-date sources, so merging them client-side
// (no new RPC) never tells two different stories about the same customer)
// and Monthly Balance (the month-by-month table on its own, unchanged, for
// when only that view is wanted).
//
// Follow-up Date is not a column here: nothing in the schema records a
// follow-up/next-contact date against a car customer, contract or
// installment (checked car_contracts, car_installments, car_receipts,
// parties — none carry it). Inventing one was explicitly ruled out; see the
// Phase 5 report to the user for what adding it would require.
export default async function OutstandingReport({ searchParams }: { searchParams: { tab?: string } }) {
  await guardStaffPage("carsales.reports");
  const supabase = createClient();
  const tab = searchParams.tab === "monthly" ? "monthly" : "ageing";

  return (
    <div>
      <PageHeader title="Car Customer Balances">
        <PrintButton />
      </PageHeader>
      <div className="mb-4 flex gap-2 print:hidden">
        {[["ageing", "Customer Due Ageing Summary"], ["monthly", "Monthly Balance"]].map(([k, l]) => (
          <Link key={k} href={`/car-sales/reports/outstanding?tab=${k}`}
            className={`rounded-full px-3 py-1 text-sm ${tab === k ? "bg-brand text-white" : "bg-slate-100 text-slate-600"}`}>{l}</Link>
        ))}
      </div>
      {tab === "ageing" ? await AgeingSummary(supabase) : await MonthlyBalance(supabase)}
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
    // this merged view never drops activity the Monthly Balance tab shows.
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

  return (
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
              <tr key={r.id} className={`border-t border-slate-100 ${i % 2 === 1 ? "bg-slate-50/70" : ""}`}>
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
  );
}

async function MonthlyBalance(supabase: ReturnType<typeof createClient>) {
  const { data } = await supabase.rpc("car_customer_monthwise", { p_company: COMPANY_ID });
  const rows = ((data ?? []) as any[]).filter((r) =>
    [r.due_cur, r.due_last, r.due_l2, r.due_l3, r.due_prev, r.rcpt_cur, r.rcpt_last, r.rcpt_l2, r.rcpt_l3]
      .some((v) => Math.abs(Number(v || 0)) > 0.005));

  const sum = (k: string) => rows.reduce((s, r) => s + Number(r[k] || 0), 0);
  const MONTHS = ["This Month", "Last Month", "2 Months Ago", "3 Months Ago"];

  return (
    <div className="card overflow-x-auto p-0">
      <table className="report-grid w-full min-w-[900px] text-sm">
        <thead className="bg-brand-50 text-[11px] font-semibold uppercase tracking-wide text-brand-800">
          <tr>
            <th className="px-4 py-2.5 text-left" rowSpan={2}><span className="col-resize">Customer</span></th>
            <th className={`px-2 py-2.5 text-center ${DUE_BG}`} colSpan={5}>Due</th>
            <th className={`px-2 py-2.5 text-center ${RCPT_BG}`} colSpan={4}>Receipts</th>
          </tr>
          <tr>
            {MONTHS.map((m) => <th key={`d${m}`} className={`px-2 py-2.5 text-right ${DUE_BG}`}><span className="col-resize-wrap">{m}</span></th>)}
            <th className={`px-2 py-2.5 text-right ${DUE_BG}`}><span className="col-resize-wrap">Previous</span></th>
            {MONTHS.map((m) => <th key={`r${m}`} className={`px-2 py-2.5 text-right ${RCPT_BG}`}><span className="col-resize-wrap">{m}</span></th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.customer_id} className={`border-t border-slate-100 ${i % 2 === 1 ? "bg-slate-50/70" : ""}`}>
              <td className="td"><Link href={`/car-sales/customers/${r.customer_id}`} className="text-brand hover:underline">{r.name}</Link></td>
              <td className={`td text-right tabular-nums ${DUE_BG}`}>{num(r.due_cur)}</td>
              <td className={`td text-right tabular-nums ${DUE_BG}`}>{num(r.due_last)}</td>
              <td className={`td text-right tabular-nums ${DUE_BG}`}>{num(r.due_l2)}</td>
              <td className={`td text-right tabular-nums ${DUE_BG}`}>{num(r.due_l3)}</td>
              <td className={`td text-right tabular-nums text-red-600 ${DUE_BG}`}>{num(r.due_prev)}</td>
              <td className={`td text-right tabular-nums text-green-700 ${RCPT_BG}`}>{num(r.rcpt_cur)}</td>
              <td className={`td text-right tabular-nums text-green-700 ${RCPT_BG}`}>{num(r.rcpt_last)}</td>
              <td className={`td text-right tabular-nums text-green-700 ${RCPT_BG}`}>{num(r.rcpt_l2)}</td>
              <td className={`td text-right tabular-nums text-green-700 ${RCPT_BG}`}>{num(r.rcpt_l3)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={10}>Nothing due or received in this window.</td></tr>}
        </tbody>
        {rows.length > 0 && <tfoot><tr className="border-t-2 border-slate-200 font-semibold">
          <td className="td">Total</td>
          <td className={`td text-right tabular-nums ${DUE_BG}`}>{num(sum("due_cur"))}</td>
          <td className={`td text-right tabular-nums ${DUE_BG}`}>{num(sum("due_last"))}</td>
          <td className={`td text-right tabular-nums ${DUE_BG}`}>{num(sum("due_l2"))}</td>
          <td className={`td text-right tabular-nums ${DUE_BG}`}>{num(sum("due_l3"))}</td>
          <td className={`td text-right tabular-nums ${DUE_BG}`}>{num(sum("due_prev"))}</td>
          <td className={`td text-right tabular-nums ${RCPT_BG}`}>{num(sum("rcpt_cur"))}</td>
          <td className={`td text-right tabular-nums ${RCPT_BG}`}>{num(sum("rcpt_last"))}</td>
          <td className={`td text-right tabular-nums ${RCPT_BG}`}>{num(sum("rcpt_l2"))}</td>
          <td className={`td text-right tabular-nums ${RCPT_BG}`}>{num(sum("rcpt_l3"))}</td>
        </tr></tfoot>}
      </table>
    </div>
  );
}
