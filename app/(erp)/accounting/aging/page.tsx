import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { COMPANY_ID } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import AgingRows from "./AgingRows";

export const dynamic = "force-dynamic";

const money = (n: number) => n ? new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) : "";

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="card">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-bold ${tone ?? "text-slate-800"}`}>{value}</p>
    </div>
  );
}

// A/R & A/P — the dashboard card's detail screen. `total`/`not_due`/`b0..b4`
// are what is BILLED, aged by due date (from open_items — the only place a
// due date lives); `ledger_balance` is what the party's account actually owes
// (ar_ap_aging(), migration 408) — the two can differ when a receipt was
// saved ON ACCOUNT (nothing picked in the popup) rather than adjusted against
// a bill, and showing both side by side is what surfaces that instead of
// hiding it.
export default async function AgingPage({ searchParams }: { searchParams: { kind?: string } }) {
  const sb = createClient();
  const kind = searchParams.kind === "supplier" ? "supplier" : "customer";
  const { data } = await sb.rpc("ar_ap_aging", { p_company: COMPANY_ID, p_kind: kind });
  const rows = (data ?? []) as any[];
  const sum = (k: string) => rows.reduce((s, r) => s + Number(r[k] || 0), 0);
  const overdue = sum("total") - sum("not_due");

  return (
    <div className="space-y-4">
      <PageHeader title={kind === "customer" ? "Receivables Aging" : "Payables Aging"}
        subtitle="Aged by due date. Not due is what has been billed but is not yet due — an instalment for next month, a bill inside its credit days.">
        <PrintButton />
      </PageHeader>
      <div className="flex gap-2 print:hidden">
        {[["customer", "Receivables"], ["supplier", "Payables"]].map(([k, l]) => (
          <Link key={k} href={`/accounting/aging?kind=${k}`}
            className={`rounded-full px-3 py-1 text-sm ${kind === k ? "bg-brand text-white" : "bg-slate-100 text-slate-600"}`}>{l}</Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label={`Total ${kind === "customer" ? "Receivables" : "Payables"} (Billed)`} value={money(sum("total"))} />
        <Kpi label="Not Due" value={money(sum("not_due"))} />
        <Kpi label="Overdue" value={money(overdue)} tone={overdue > 0 ? "text-red-600" : "text-green-700"} />
        <Kpi label="Ledger Balance" value={money(sum("ledger_balance"))} />
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">{kind === "customer" ? "Customer" : "Supplier"}</th>
              <th className="px-3 py-2 text-right">Billed Total</th>
              <th className="px-3 py-2 text-right">Not due</th>
              <th className="px-3 py-2 text-right">0–30</th>
              <th className="px-3 py-2 text-right">31–60</th>
              <th className="px-3 py-2 text-right">61–90</th>
              <th className="px-3 py-2 text-right">91–180</th>
              <th className="px-3 py-2 text-right">180+</th>
              <th className="px-3 py-2 text-right">Ledger Balance</th>
              <th className="sticky right-0 bg-slate-50 px-3 py-2 print:hidden" />
            </tr>
          </thead>
          <tbody>
            <AgingRows rows={rows as any} kind={kind} />
            {rows.length === 0 && <tr><td className="px-3 py-6 text-center text-slate-400" colSpan={10}>Nothing outstanding.</td></tr>}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
              <td className="px-3 py-2">Total</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(sum("total"))}</td>
              <td className="px-3 py-2 text-right tabular-nums text-slate-400">{money(sum("not_due"))}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(sum("b0"))}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(sum("b1"))}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(sum("b2"))}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(sum("b3"))}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(sum("b4"))}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(sum("ledger_balance"))}</td>
              <td className="sticky right-0 bg-slate-50 print:hidden" />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
