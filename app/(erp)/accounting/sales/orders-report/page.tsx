import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { COMPANY_ID, dateStr } from "@/lib/format";
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

// Sale Order has never had a list screen — a clerk finds one by typing its
// number into the header's own Document No. box. This report is the one for
// browsing/analysing rather than finding a specific number: report_sale_orders()
// (migration 411), pending vs history, reusing the same advance/received
// definition dashboard_metrics()'s so_pending CTE already uses. Rows open the
// real voucher editor via ?id=.
export default async function SalesOrdersReportPage({ searchParams }: { searchParams: { status?: string } }) {
  const sb = createClient();
  const status = searchParams.status === "history" ? "history" : searchParams.status === "all" ? "all" : "pending";
  const { data } = await sb.rpc("report_sale_orders", { p_company: COMPANY_ID, p_status: status });
  const rows = ((data as any)?.rows ?? []) as any[];
  const total = rows.reduce((s, r) => s + Number(r.total || 0), 0);
  const advPending = rows.reduce((s, r) => s + Math.max(0, Number(r.advance_balance || 0)), 0);

  return (
    <div className="space-y-4">
      <PageHeader title="Sales Orders Report" subtitle="Every Sale Order, pending or history — advance and received match the dashboard's own figures.">
        <PrintButton />
      </PageHeader>
      <div className="flex gap-2 print:hidden">
        {[["pending", "Pending"], ["history", "History"], ["all", "All"]].map(([k, l]) => (
          <Link key={k} href={`/accounting/sales/orders-report?status=${k}`}
            className={`rounded-full px-3 py-1 text-sm ${status === k ? "bg-brand text-white" : "bg-slate-100 text-slate-600"}`}>{l}</Link>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Orders" value={String(rows.length)} />
        <Kpi label="Total Value" value={money(total)} />
        <Kpi label="Advance Pending" value={money(advPending)} tone={advPending > 0 ? "text-amber-700" : "text-green-700"} />
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[960px] text-sm">
          <thead className="bg-slate-50"><tr>
            <th className="th">Order No</th><th className="th">Date</th><th className="th">Delivery</th>
            <th className="th">Customer</th><th className="th">Cost Centre</th>
            <th className="th text-right">Amount</th><th className="th text-right">Advance</th>
            <th className="th text-right">Received</th><th className="th text-right">Balance</th><th className="th">Status</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.doc_id} className="border-t border-slate-100">
                <td className="td"><Link href={`/accounting/sales/orders?id=${r.doc_id}`} className="text-brand hover:underline">{r.doc_no}</Link></td>
                <td className="td">{dateStr(r.doc_date)}</td>
                <td className="td">{r.delivery_date ? dateStr(r.delivery_date) : "—"}</td>
                <td className="td">{r.customer}</td>
                <td className="td">{r.cost_centre}</td>
                <td className="td text-right tabular-nums">{money(r.total)}</td>
                <td className="td text-right tabular-nums">{money(r.advance)}</td>
                <td className="td text-right tabular-nums">{money(r.advance_received)}</td>
                <td className="td text-right tabular-nums font-medium">{money(r.advance_balance)}</td>
                <td className="td">{r.consumed ? <span className="badge bg-green-100 text-green-700">Invoiced</span> : <span className="badge bg-amber-100 text-amber-700">Pending</span>}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={10}>Nothing here.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
