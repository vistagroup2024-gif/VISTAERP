import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { COMPANY_ID, dateStr } from "@/lib/format";
import { todaySA, yearSA } from "@/lib/saudiTime";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";

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
export default async function CustomerReportPage({ params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: account } = await sb.from("accounts").select("id, code, name, subtype, party_id").eq("id", params.id).maybeSingle();
  if (!account) return <div><PageHeader title="Account" /><p className="text-sm text-slate-400">Not found.</p></div>;

  const { data: party } = account.party_id
    ? await sb.from("parties").select("id, name, phone, email, party_type, credit_limit, credit_days").eq("id", account.party_id).maybeSingle()
    : { data: null };

  const kind = account.subtype === "Payable" ? "supplier" : "customer";
  const { data: agingRows } = await sb.rpc("ar_ap_aging", { p_company: COMPANY_ID, p_kind: kind });
  const row = ((agingRows ?? []) as any[]).find((r) => r.account_id === account.id);

  const from = `${yearSA()}-01-01`;
  const to = todaySA();
  const { data: txnData } = await sb.rpc("report_transactions", { p_company: COMPANY_ID, p_from: from, p_to: to, p_account_ids: [account.id] });
  const txns = ((txnData ?? []) as any[]).slice(0, 50);

  const { data: carLink } = party ? await sb.from("car_contracts").select("id").eq("customer_id", party.id).limit(1) : { data: [] };

  return (
    <div className="space-y-4">
      <PageHeader title={party?.name ?? account.name} subtitle={`${party?.phone ?? ""} ${party?.email ? "· " + party.email : ""}`.trim() || account.code}>
        <PrintButton />
        {!!carLink?.length && <Link href={`/car-sales/customers/${party!.id}`} className="btn-outline">Car Sales Detail →</Link>}
        <Link href={`/accounting/ledger?account=${account.id}`} className="btn-outline">Full Ledger →</Link>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Billed Total" value={money(row?.total)} />
        <Kpi label="Not Due" value={money(row?.not_due)} />
        <Kpi label="Overdue" value={money(Number(row?.total || 0) - Number(row?.not_due || 0))} tone="text-red-600" />
        <Kpi label="Ledger Balance" value={money(row?.ledger_balance)} />
      </div>

      {row && (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <tr><th className="px-3 py-2 text-left">Ageing</th><th className="px-3 py-2 text-right">Not Due</th>
                <th className="px-3 py-2 text-right">0-30</th><th className="px-3 py-2 text-right">31-60</th>
                <th className="px-3 py-2 text-right">61-90</th><th className="px-3 py-2 text-right">91-180</th>
                <th className="px-3 py-2 text-right">180+</th></tr>
            </thead>
            <tbody><tr className="border-t border-slate-100">
              <td className="px-3 py-2 font-medium">Amount</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(row.not_due)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(row.b0)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(row.b1)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(row.b2)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(row.b3)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-red-600">{money(row.b4)}</td>
            </tr></tbody>
          </table>
        </div>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Recent Transactions (this year)</h2>
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <tr><th className="px-3 py-2 text-left">Voucher No</th><th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th>
                <th className="px-3 py-2 text-left">Remarks</th></tr>
            </thead>
            <tbody>
              {txns.map((t: any) => (
                <tr key={`${t.entry_id}-${t.voucher_no}`} className="border-t border-slate-100">
                  <td className="px-3 py-1.5">{t.voucher_no}</td>
                  <td className="px-3 py-1.5">{dateStr(t.date)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{money(t.debit)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{money(t.credit)}</td>
                  <td className="px-3 py-1.5">{t.remarks ?? ""}</td>
                </tr>
              ))}
              {txns.length === 0 && <tr><td className="px-3 py-6 text-center text-slate-400" colSpan={5}>No transactions this year.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
