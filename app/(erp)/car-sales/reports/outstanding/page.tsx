import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import { COMPANY_ID } from "@/lib/format";
import { sar } from "../../lib";

export const dynamic = "force-dynamic";

// This is the dashboard's Car Customer Balances card, per customer instead of
// summed. car_customer_balances() is car_money's (dashboard_metrics()) own
// per-customer breakdown — same three sources (instalments, the invoice
// advance, the monthly service charge), same disjoint Due/Overdue split, same
// ledger balance — so a row here always foots to what the card shows.
// Building this report's own totals from car_installments alone, the way it
// did before, is what let it disagree with the card in the first place.
//
// TWO TABS: Customer Due Ageing Summary (default — "what is owed right now")
// and Monthly Balance (car_customer_monthwise(), migration 410 — "what was
// due and collected, month by month, current back through 3 months and
// everything older"). Both read the same three due-date sources, so they
// never tell two different stories about the same customer.
export default async function OutstandingReport({ searchParams }: { searchParams: { tab?: string } }) {
  await guardStaffPage("carsales.reports");
  const supabase = createClient();
  const tab = searchParams.tab === "monthly" ? "monthly" : "ageing";

  return (
    <div>
      <PageHeader title="Car Customer Balances" subtitle="Everything a car customer owes — instalments, the invoice advance and the monthly service charge, the same as the dashboard's Car Customer Balances card.">
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
  const { data } = await supabase.rpc("car_customer_balances");
  const rows = ((data ?? []) as any[]).map((r) => ({
    id: r.customer_id, name: r.name ?? "—", phone: r.phone ?? "—",
    cars: Number(r.cars || 0), value: Number(r.value || 0), advance: Number(r.advance || 0),
    due: Number(r.due || 0), overdue: Number(r.overdue || 0), total_due: Number(r.total_due || 0),
    collected: Number(r.collected || 0), balance: Number(r.balance || 0),
  })).filter((r) => Math.abs(r.balance) > 0.005 || r.total_due > 0.005);
  const t = rows.reduce((a, r) => ({
    value: a.value + r.value, due: a.due + r.due, overdue: a.overdue + r.overdue,
    total_due: a.total_due + r.total_due, collected: a.collected + r.collected, balance: a.balance + r.balance,
  }), { value: 0, due: 0, overdue: 0, total_due: 0, collected: 0, balance: 0 });

  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full min-w-[900px]">
        <thead className="bg-slate-50"><tr>
          <th className="th">Customer</th><th className="th">Mobile</th><th className="th text-right">Cars</th>
          <th className="th text-right">Contract Value</th>
          <th className="th text-right">Due</th><th className="th text-right">Overdue</th>
          <th className="th text-right">Total Due</th><th className="th text-right">Collected</th>
          <th className="th text-right">Ledger Balance</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-slate-100">
              <td className="td"><Link href={`/car-sales/customers/${r.id}`} className="text-brand hover:underline">{r.name}</Link></td>
              <td className="td">{r.phone}</td>
              <td className="td text-right">{r.cars}</td>
              <td className="td text-right tabular-nums">{sar(r.value)}</td>
              <td className="td text-right tabular-nums">{r.due > 0 ? <span className="text-amber-700">{sar(r.due)}</span> : "—"}</td>
              <td className="td text-right tabular-nums">{r.overdue > 0 ? <span className="text-red-600">{sar(r.overdue)}</span> : "—"}</td>
              <td className="td text-right tabular-nums font-medium">{sar(r.total_due)}</td>
              <td className="td text-right tabular-nums">{sar(r.collected)}</td>
              <td className="td text-right tabular-nums font-medium">{sar(r.balance)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={9}>No outstanding balances.</td></tr>}
        </tbody>
        {rows.length > 0 && <tfoot><tr className="border-t-2 border-slate-200 font-semibold">
          <td className="td" colSpan={3}>Total ({rows.length})</td>
          <td className="td text-right tabular-nums">{sar(t.value)}</td>
          <td className="td text-right tabular-nums">{sar(t.due)}</td>
          <td className="td text-right tabular-nums">{sar(t.overdue)}</td>
          <td className="td text-right tabular-nums">{sar(t.total_due)}</td>
          <td className="td text-right tabular-nums">{sar(t.collected)}</td>
          <td className="td text-right tabular-nums">{sar(t.balance)}</td>
        </tr></tfoot>}
      </table>
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
      <table className="w-full min-w-[1100px] text-sm">
        <thead className="bg-slate-50">
          <tr>
            <th className="th" rowSpan={2}>Customer</th>
            <th className="th text-center" colSpan={5}>Due</th>
            <th className="th text-center" colSpan={4}>Receipts</th>
          </tr>
          <tr>
            {MONTHS.map((m) => <th key={`d${m}`} className="th text-right">{m}</th>)}
            <th className="th text-right">Previous</th>
            {MONTHS.map((m) => <th key={`r${m}`} className="th text-right">{m}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.customer_id} className="border-t border-slate-100">
              <td className="td"><Link href={`/car-sales/customers/${r.customer_id}`} className="text-brand hover:underline">{r.name}</Link></td>
              <td className="td text-right tabular-nums">{sar(r.due_cur)}</td>
              <td className="td text-right tabular-nums">{sar(r.due_last)}</td>
              <td className="td text-right tabular-nums">{sar(r.due_l2)}</td>
              <td className="td text-right tabular-nums">{sar(r.due_l3)}</td>
              <td className="td text-right tabular-nums text-red-600">{sar(r.due_prev)}</td>
              <td className="td text-right tabular-nums text-green-700">{sar(r.rcpt_cur)}</td>
              <td className="td text-right tabular-nums text-green-700">{sar(r.rcpt_last)}</td>
              <td className="td text-right tabular-nums text-green-700">{sar(r.rcpt_l2)}</td>
              <td className="td text-right tabular-nums text-green-700">{sar(r.rcpt_l3)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={10}>Nothing due or received in this window.</td></tr>}
        </tbody>
        {rows.length > 0 && <tfoot><tr className="border-t-2 border-slate-200 font-semibold">
          <td className="td">Total</td>
          <td className="td text-right tabular-nums">{sar(sum("due_cur"))}</td>
          <td className="td text-right tabular-nums">{sar(sum("due_last"))}</td>
          <td className="td text-right tabular-nums">{sar(sum("due_l2"))}</td>
          <td className="td text-right tabular-nums">{sar(sum("due_l3"))}</td>
          <td className="td text-right tabular-nums">{sar(sum("due_prev"))}</td>
          <td className="td text-right tabular-nums">{sar(sum("rcpt_cur"))}</td>
          <td className="td text-right tabular-nums">{sar(sum("rcpt_last"))}</td>
          <td className="td text-right tabular-nums">{sar(sum("rcpt_l2"))}</td>
          <td className="td text-right tabular-nums">{sar(sum("rcpt_l3"))}</td>
        </tr></tfoot>}
      </table>
    </div>
  );
}
