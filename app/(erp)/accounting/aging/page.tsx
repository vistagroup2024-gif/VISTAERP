import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { COMPANY_ID } from "@/lib/format";
import PageHeader from "@/components/PageHeader";

export const dynamic = "force-dynamic";

const money = (n: number) => n ? new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) : "";

export default async function AgingPage({ searchParams }: { searchParams: { kind?: string } }) {
  const sb = createClient();
  const kind = searchParams.kind === "supplier" ? "supplier" : "customer";
  const { data } = await sb.rpc("ar_ap_aging", { p_company: COMPANY_ID, p_kind: kind });
  const rows = (data ?? []) as any[];
  const sum = (k: string) => rows.reduce((s, r) => s + Number(r[k] || 0), 0);

  return (
    <div className="space-y-4">
      <PageHeader title={kind === "customer" ? "Receivables Aging" : "Payables Aging"} />
      <div className="flex gap-2">
        {[["customer", "Receivables"], ["supplier", "Payables"]].map(([k, l]) => (
          <Link key={k} href={`/accounting/aging?kind=${k}`}
            className={`rounded-full px-3 py-1 text-sm ${kind === k ? "bg-brand text-white" : "bg-slate-100 text-slate-600"}`}>{l}</Link>
        ))}
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">{kind === "customer" ? "Customer" : "Supplier"}</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2 text-right">0–30</th>
              <th className="px-3 py-2 text-right">31–60</th>
              <th className="px-3 py-2 text-right">61–90</th>
              <th className="px-3 py-2 text-right">91–180</th>
              <th className="px-3 py-2 text-right">180+</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.account_id} className="border-t border-slate-100">
                <td className="px-3 py-1.5"><Link href={`/accounting/ledger?account=${r.account_id}`} className="hover:text-brand hover:underline">{r.name}</Link>{r.phone ? <span className="ml-2 text-xs text-slate-400">{r.phone}</span> : ""}</td>
                <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{money(Number(r.total))}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{money(Number(r.b0))}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{money(Number(r.b1))}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{money(Number(r.b2))}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{money(Number(r.b3))}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-red-600">{money(Number(r.b4))}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="px-3 py-6 text-center text-slate-400" colSpan={7}>Nothing outstanding.</td></tr>}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
              <td className="px-3 py-2">Total</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(sum("total"))}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(sum("b0"))}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(sum("b1"))}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(sum("b2"))}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(sum("b3"))}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(sum("b4"))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
