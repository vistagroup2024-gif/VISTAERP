import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { COMPANY_ID } from "@/lib/format";
import PageHeader from "@/components/PageHeader";

export const dynamic = "force-dynamic";

const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

export default async function TrialBalancePage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  const sb = createClient();
  const from = searchParams.from ?? "";
  const to = searchParams.to ?? "";
  const { data } = await sb.rpc("trial_balance", { p_company: COMPANY_ID, p_from: from || null, p_to: to || null });
  const rows = (data ?? []) as any[];

  const closingDr = (r: any) => (r.closing_net >= 0 ? r.closing_net : 0);
  const closingCr = (r: any) => (r.closing_net < 0 ? -r.closing_net : 0);
  const totDr = rows.reduce((s, r) => s + closingDr(r), 0);
  const totCr = rows.reduce((s, r) => s + closingCr(r), 0);
  const balanced = Math.abs(totDr - totCr) < 0.005;

  return (
    <div className="space-y-4">
      <PageHeader title="Trial Balance" />
      <form className="card flex flex-wrap items-end gap-3" method="get">
        <div><label className="label">From</label><input type="date" name="from" defaultValue={from} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={to} className="input" /></div>
        <button className="btn">Run</button>
        <span className={`ml-auto rounded-full px-3 py-1 text-sm font-medium ${balanced ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
          {balanced ? "Balanced ✓" : `Out of balance by ${money(Math.abs(totDr - totCr))}`}
        </span>
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">Account</th>
              <th className="px-3 py-2 text-right">Opening Dr</th>
              <th className="px-3 py-2 text-right">Opening Cr</th>
              <th className="px-3 py-2 text-right">Period Dr</th>
              <th className="px-3 py-2 text-right">Period Cr</th>
              <th className="px-3 py-2 text-right">Closing Dr</th>
              <th className="px-3 py-2 text-right">Closing Cr</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-3 py-1.5"><Link href={`/accounting/ledger?account=${r.id}`} className="hover:text-brand hover:underline">{r.name}</Link></td>
                <td className="px-3 py-1.5 text-right tabular-nums">{Number(r.opening_debit) ? money(Number(r.opening_debit)) : ""}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{Number(r.opening_credit) ? money(Number(r.opening_credit)) : ""}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{Number(r.period_debit) ? money(Number(r.period_debit)) : ""}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{Number(r.period_credit) ? money(Number(r.period_credit)) : ""}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{closingDr(r) ? money(closingDr(r)) : ""}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{closingCr(r) ? money(closingCr(r)) : ""}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="px-3 py-6 text-center text-slate-400" colSpan={8}>No account activity.</td></tr>}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
              <td className="px-3 py-2" colSpan={6}>Total</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(totDr)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(totCr)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
