import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { COMPANY_ID, dateStr } from "@/lib/format";
import { todaySA, yearSA } from "@/lib/saudiTime";
import { periodLabel, type YearMonths } from "@/lib/reports/period";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import SectionHeader from "@/components/reports/SectionHeader";
import CustomerPeriodControl from "./CustomerPeriodControl";

export const dynamic = "force-dynamic";
const money = (n: any) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="card">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-bold ${tone ?? "text-slate-800"}`}>{value}</p>
    </div>
  );
}

// A customer's (or supplier's) complete financial picture on one screen —
// keyed by ACCOUNT id, the same key the Aging report and the Ledger already
// use. Ledger balance and ageing come from ar_ap_aging() (migration 408),
// recent transactions from report_transactions() (migration 415), both
// filtered to this one account — nothing new computed, everything already
// verified against the dashboard card. A car-sales customer gets a link
// through to their car-specific breakdown (car_customer_balances) rather
// than this page trying to also be that one.
export default async function CustomerReportPage({ params, searchParams }: { params: { id: string }; searchParams: { from?: string; to?: string } }) {
  const sb = createClient();
  const { data: account } = await sb.from("accounts").select("id, code, name, subtype, party_id").eq("id", params.id).maybeSingle();
  if (!account) return <div><PageHeader title="Account" /><p className="text-sm text-slate-400">Not found.</p></div>;

  const { data: party } = account.party_id
    ? await sb.from("parties").select("id, name, phone, email, party_type, credit_limit, credit_days, iqama_no, iqama_expiry").eq("id", account.party_id).maybeSingle()
    : { data: null };

  const kind = account.subtype === "Payable" ? "supplier" : "customer";
  const { data: agingRows } = await sb.rpc("ar_ap_aging", { p_company: COMPANY_ID, p_kind: kind });
  const row = ((agingRows ?? []) as any[]).find((r) => r.account_id === account.id);

  const from = searchParams.from || `${yearSA()}-01-01`;
  const to = searchParams.to || todaySA();
  const { data: txnData } = await sb.rpc("report_transactions", { p_company: COMPANY_ID, p_from: from, p_to: to, p_account_ids: [account.id] });
  const txns = ((txnData ?? []) as any[]).slice(0, 50);

  // Approximate the selected {from,to} back to a Year+Months value for the
  // control's own initial state — a plain Jan-of-from..month-of-to run,
  // which is exactly what monthRanges() turns it back into on change.
  const fromYear = Number(from.slice(0, 4));
  const fromMonth = Number(from.slice(5, 7));
  const toYear = Number(to.slice(0, 4));
  const toMonth = Number(to.slice(5, 7));
  const initialYm: YearMonths = fromYear === toYear
    ? { year: fromYear, months: Array.from({ length: toMonth - fromMonth + 1 }, (_, i) => fromMonth + i) }
    : { year: toYear, months: Array.from({ length: 12 }, (_, i) => i + 1) };

  const { data: billsData } = await sb.rpc("party_outstanding", { p_company: COMPANY_ID, p_account_id: account.id });
  const bills = (billsData ?? []) as any[];

  const { data: mwData } = await sb.rpc("report_customer_monthwise", { p_company: COMPANY_ID, p_account_id: account.id });
  const mw = (mwData as any) ?? {};

  const { data: carLink } = party ? await sb.from("car_contracts").select("id").eq("customer_id", party.id).limit(1) : { data: [] };

  return (
    <div className="space-y-4">
      <PageHeader title={party?.name ?? account.name}
        subtitle={`${party?.phone ?? ""} ${party?.email ? "· " + party.email : ""} ${party?.iqama_no ? "· Iqama " + party.iqama_no : ""}`.trim() || account.code}>
        <PrintButton />
        {!!carLink?.length && <Link href={`/car-sales/customers/${party!.id}`} className="btn-outline">Car Sales Detail →</Link>}
        <Link href={`/accounting/ledger?account=${account.id}`} className="btn-outline">Full Ledger →</Link>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Due" value={money(row?.due)} />
        <Kpi label="Overdue" value={money(row?.overdue)} tone="text-red-600" />
        <Kpi label="Total Due" value={money(row?.total_due)} />
        <Kpi label="Ledger Balance" value={money(row?.ledger_balance)} />
      </div>

      {row && (
        <div className="card overflow-x-auto p-0">
          <table className="report-grid w-full text-sm">
            <thead className="bg-brand-50 text-[11px] font-semibold uppercase tracking-wide text-brand-800">
              <tr><th className="px-3 py-2 text-left"><span className="col-resize">Coming due</span></th><th className="px-3 py-2 text-right"><span className="col-resize">0-30d</span></th>
                <th className="px-3 py-2 text-right"><span className="col-resize">31-60d</span></th><th className="px-3 py-2 text-right"><span className="col-resize">61-90d</span></th>
                <th className="px-3 py-2 text-right"><span className="col-resize">91-180d</span></th><th className="px-3 py-2 text-right"><span className="col-resize">180d+</span></th></tr>
            </thead>
            <tbody><tr className="border-t border-slate-100">
              <td className="px-3 py-2 font-medium">Amount</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(row.f0)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(row.f1)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(row.f2)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(row.f3)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(row.f4)}</td>
            </tr></tbody>
          </table>
        </div>
      )}

      {/* Open bills — party_outstanding(), the same read the voucher's own
         bill-wise-adjustment popup uses, so this list and what a Receipt/
         Payment can adjust against never disagree. */}
      <div>
        <SectionHeader title="Open Bills" />
        <div className="card overflow-x-auto p-0">
          <table className="report-grid w-full text-sm">
            <thead className="bg-brand-50 text-[11px] font-semibold uppercase tracking-wide text-brand-800">
              <tr><th className="px-3 py-2 text-left"><span className="col-resize">Bill No</span></th><th className="px-3 py-2 text-left"><span className="col-resize">Bill Date</span></th>
                <th className="px-3 py-2 text-left"><span className="col-resize">Due Date</span></th><th className="px-3 py-2 text-right"><span className="col-resize">Amount</span></th>
                <th className="px-3 py-2 text-right"><span className="col-resize">Adjusted</span></th><th className="px-3 py-2 text-right"><span className="col-resize">Balance</span></th></tr>
            </thead>
            <tbody>
              {bills.map((b: any, i: number) => (
                <tr key={b.id} className={`border-t border-slate-100 ${i % 2 === 1 ? "bg-slate-50/70" : ""}`}>
                  <td className="px-3 py-1.5">{b.doc_no}</td>
                  <td className="px-3 py-1.5">{dateStr(b.doc_date)}</td>
                  <td className="px-3 py-1.5">{b.due_date ? dateStr(b.due_date) : "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{money(b.amount)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{money(Number(b.amount) - Number(b.outstanding))}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-medium">{money(b.outstanding)}</td>
                </tr>
              ))}
              {bills.length === 0 && <tr><td className="px-3 py-6 text-center text-slate-400" colSpan={6}>No open bills — fully adjusted, or the balance above came from the ledger directly.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Monthwise — report_customer_monthwise(), the same This/Last/2-ago/
         3-ago/Older bucket shape the Car Customer Balances Monthly Balance
         tab already uses, generalised off the ledger for any receivable/
         payable account. */}
      <div>
        <SectionHeader title="Monthwise Receivables &amp; Receipts" />
        <div className="card overflow-x-auto p-0">
          <table className="report-grid w-full text-sm">
            <thead className="bg-brand-50 text-[11px] font-semibold uppercase tracking-wide text-brand-800">
              <tr><th className="px-3 py-2 text-left"> </th><th className="px-3 py-2 text-right"><span className="col-resize">This Month</span></th>
                <th className="px-3 py-2 text-right"><span className="col-resize">Last Month</span></th><th className="px-3 py-2 text-right"><span className="col-resize-wrap">2 Months Ago</span></th>
                <th className="px-3 py-2 text-right"><span className="col-resize-wrap">3 Months Ago</span></th><th className="px-3 py-2 text-right"><span className="col-resize">Older</span></th></tr>
            </thead>
            <tbody>
              <tr className="border-t border-slate-100">
                <td className="px-3 py-1.5 font-medium">Billed</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{money(mw.billed_cur)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{money(mw.billed_last)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{money(mw.billed_l2)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{money(mw.billed_l3)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-red-600">{money(mw.billed_prev)}</td>
              </tr>
              <tr className="border-t border-slate-100">
                <td className="px-3 py-1.5 font-medium">Received</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-green-700">{money(mw.received_cur)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-green-700">{money(mw.received_last)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-green-700">{money(mw.received_l2)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-green-700">{money(mw.received_l3)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex-1"><SectionHeader title={`Recent Transactions — ${periodLabel(initialYm)}`} /></div>
          <CustomerPeriodControl initial={initialYm} />
        </div>
        <div className="card overflow-x-auto p-0">
          <table className="report-grid w-full text-sm">
            <thead className="bg-brand-50 text-[11px] font-semibold uppercase tracking-wide text-brand-800">
              <tr><th className="px-3 py-2 text-left"><span className="col-resize">Voucher No</span></th><th className="px-3 py-2 text-left"><span className="col-resize">Date</span></th>
                <th className="px-3 py-2 text-right"><span className="col-resize">Debit</span></th><th className="px-3 py-2 text-right"><span className="col-resize">Credit</span></th>
                <th className="px-3 py-2 text-left"><span className="col-resize">Remarks</span></th></tr>
            </thead>
            <tbody>
              {txns.map((t: any, i: number) => (
                <tr key={`${t.entry_id}-${t.voucher_no}`} className={`border-t border-slate-100 ${i % 2 === 1 ? "bg-slate-50/70" : ""}`}>
                  <td className="px-3 py-1.5">{t.voucher_no}</td>
                  <td className="px-3 py-1.5">{dateStr(t.date)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{money(t.debit)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{money(t.credit)}</td>
                  <td className="px-3 py-1.5">{t.remarks ?? ""}</td>
                </tr>
              ))}
              {txns.length === 0 && <tr><td className="px-3 py-6 text-center text-slate-400" colSpan={5}>No transactions in this period.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
