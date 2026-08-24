import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { COMPANY_ID } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import LedgerControls from "./LedgerControls";

export const dynamic = "force-dynamic";

const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));
const drcr = (n: number) => `${money(n)} ${n >= 0 ? "Dr" : "Cr"}`;

export default async function LedgerPage({ searchParams }: { searchParams: { account?: string; from?: string; to?: string } }) {
  const sb = createClient();
  const { data: accs } = await sb.from("accounts")
    .select("id, code, name").eq("is_postable", true).order("code");
  const accounts = (accs ?? []) as any[];
  const account = searchParams.account ?? "";
  const from = searchParams.from ?? "";
  const to = searchParams.to ?? "";

  let opening = 0; let rows: any[] = []; let acctName = "";
  if (account) {
    const { data } = await sb.rpc("acct_ledger", {
      p_company: COMPANY_ID, p_account_ids: [account], p_from: from || null, p_to: to || null,
    });
    const d = (data ?? {}) as any;
    opening = Number(d.opening ?? 0);
    rows = (d.rows ?? []) as any[];
    acctName = accounts.find((a) => a.id === account) ? `${accounts.find((a) => a.id === account).code} · ${accounts.find((a) => a.id === account).name}` : "";
  }

  let running = opening;

  return (
    <div className="space-y-4">
      <PageHeader title="Ledger" />
      <LedgerControls accounts={accounts} account={account} from={from} to={to} />

      {account && (
        <div className="card overflow-x-auto p-0">
          <div className="border-b border-slate-200 p-3 font-semibold">{acctName}</div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Voucher</th>
                <th className="px-3 py-2 text-left">Narration</th>
                <th className="px-3 py-2 text-right">Debit</th>
                <th className="px-3 py-2 text-right">Credit</th>
                <th className="px-3 py-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-slate-100 bg-slate-50/50 font-medium">
                <td className="px-3 py-2" colSpan={5}>Opening Balance</td>
                <td className="px-3 py-2 text-right tabular-nums">{drcr(opening)}</td>
              </tr>
              {rows.map((r, i) => {
                running += Number(r.debit) - Number(r.credit);
                return (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-3 py-2 whitespace-nowrap">{r.date}</td>
                    <td className="px-3 py-2"><Link href={`/accounting/vouchers/${r.entry_id}`} className="font-mono text-xs text-brand hover:underline">{r.entry_no}</Link></td>
                    <td className="px-3 py-2 text-slate-600">{r.memo}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{Number(r.debit) ? money(Number(r.debit)) : ""}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{Number(r.credit) ? money(Number(r.credit)) : ""}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{drcr(running)}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td className="px-3 py-6 text-center text-slate-400" colSpan={6}>No entries in this range.</td></tr>}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                <td className="px-3 py-2" colSpan={5}>Closing Balance</td>
                <td className="px-3 py-2 text-right tabular-nums">{drcr(running)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {!account && <div className="card text-slate-400">Choose an account and click Run.</div>}
    </div>
  );
}
