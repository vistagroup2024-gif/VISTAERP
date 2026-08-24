import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { COMPANY_ID } from "@/lib/format";
import PageHeader from "@/components/PageHeader";

export const dynamic = "force-dynamic";
const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(n));

export default async function AccountingHome() {
  const sb = createClient();
  const { data } = await sb.rpc("acct_dashboard", { p_company: COMPANY_ID });
  const d = (data ?? {}) as any;
  const net = Number(d.income ?? 0) - Number(d.expense ?? 0);

  const Tile = ({ label, value, href, tone = "" }: { label: string; value: string; href?: string; tone?: string }) => {
    const inner = (
      <div className={`card ${href ? "transition hover:shadow-md" : ""}`}>
        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
        <div className={`mt-1 text-2xl font-bold tabular-nums ${tone}`}>{value}</div>
      </div>
    );
    return href ? <Link href={href}>{inner}</Link> : inner;
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Accounting" action={{ href: "/accounting/receipts", label: "+ Receipt" }} />
      {d.closed_through && <div className="rounded bg-slate-100 px-3 py-2 text-sm text-slate-600">Books closed through <b>{d.closed_through}</b> — postings on or before this date are blocked.</div>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Cash & Bank" value={`SAR ${money(d.cash_bank ?? 0)}`} href="/accounting/ledger" />
        <Tile label="Receivables" value={`SAR ${money(d.receivables ?? 0)}`} href="/accounting/aging?kind=customer" />
        <Tile label="Payables" value={`SAR ${money(d.payables ?? 0)}`} href="/accounting/aging?kind=supplier" tone="text-red-600" />
        <Tile label="Pending Approvals" value={String(d.pending_approvals ?? 0)} href="/accounting/approvals" tone={Number(d.pending_approvals) ? "text-amber-600" : ""} />
        <Tile label="Income (all time)" value={`SAR ${money(d.income ?? 0)}`} href="/accounting/profit-loss" />
        <Tile label="Expense (all time)" value={`SAR ${money(d.expense ?? 0)}`} href="/accounting/profit-loss" />
        <Tile label={net >= 0 ? "Net Profit" : "Net Loss"} value={`SAR ${money(Math.abs(net))}`} tone={net >= 0 ? "text-green-700" : "text-red-700"} href="/accounting/profit-loss" />
        <Tile label="PDC due ≤ 14 days" value={String(d.pdc_due_soon ?? 0)} href="/accounting/pdc" tone={Number(d.pdc_due_soon) ? "text-amber-600" : ""} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-0">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 font-semibold text-slate-700">Top Debtors</div>
          <table className="w-full text-sm"><tbody>
            {(d.top_debtors ?? []).map((t: any, i: number) => (<tr key={i} className="border-b border-slate-50"><td className="px-4 py-1.5">{t.name}</td><td className="px-4 py-1.5 text-right tabular-nums">{money(t.amount)}</td></tr>))}
            {(d.top_debtors ?? []).length === 0 && <tr><td className="px-4 py-3 text-slate-400">None</td><td /></tr>}
          </tbody></table>
        </div>
        <div className="card p-0">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 font-semibold text-slate-700">Top Creditors</div>
          <table className="w-full text-sm"><tbody>
            {(d.top_creditors ?? []).map((t: any, i: number) => (<tr key={i} className="border-b border-slate-50"><td className="px-4 py-1.5">{t.name}</td><td className="px-4 py-1.5 text-right tabular-nums">{money(t.amount)}</td></tr>))}
            {(d.top_creditors ?? []).length === 0 && <tr><td className="px-4 py-3 text-slate-400">None</td><td /></tr>}
          </tbody></table>
        </div>
      </div>
    </div>
  );
}
