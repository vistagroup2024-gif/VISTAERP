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

// Purchase Order's list/browse screen — report_purchase_orders() (migration
// 412), same pending/history split and the same "received against" check
// dashboard_metrics() already uses. Rows open the real voucher editor via
// ?id=.
export default async function PurchaseOrdersReportPage({ searchParams }: { searchParams: { status?: string } }) {
  const sb = createClient();
  const status = searchParams.status === "history" ? "history" : searchParams.status === "all" ? "all" : "pending";
  const { data } = await sb.rpc("report_purchase_orders", { p_company: COMPANY_ID, p_status: status });
  const rows = ((data as any)?.rows ?? []) as any[];
  const total = rows.reduce((s, r) => s + Number(r.total || 0), 0);
  const balance = rows.reduce((s, r) => s + Number(r.balance_value || 0), 0);

  return (
    <div className="space-y-4">
      <PageHeader title="Purchase Orders Report" subtitle="Every Purchase Order, pending or history — received value from the Purchase Vouchers actually raised against it.">
        <PrintButton />
      </PageHeader>
      <div className="flex gap-2 print:hidden">
        {[["pending", "Pending"], ["history", "History"], ["all", "All"]].map(([k, l]) => (
          <Link key={k} href={`/accounting/purchases/orders-report?status=${k}`}
            className={`rounded-full px-3 py-1 text-sm ${status === k ? "bg-brand text-white" : "bg-slate-100 text-slate-600"}`}>{l}</Link>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Orders" value={String(rows.length)} />
        <Kpi label="Total Value" value={money(total)} />
        <Kpi label="Balance to Receive" value={money(balance)} tone={balance > 0 ? "text-amber-700" : "text-green-700"} />
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-slate-50"><tr>
            <th className="th">PO No</th><th className="th">Date</th><th className="th">Delivery</th>
            <th className="th">Supplier</th><th className="th">Cost Centre</th>
            <th className="th text-right">PO Value</th><th className="th text-right">Received</th>
            <th className="th text-right">Balance</th><th className="th">Status</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.doc_id} className="border-t border-slate-100">
                <td className="td"><Link href={`/accounting/purchases/orders?id=${r.doc_id}`} className="text-brand hover:underline">{r.doc_no}</Link></td>
                <td className="td">{dateStr(r.doc_date)}</td>
                <td className="td">{r.delivery_date ? dateStr(r.delivery_date) : "—"}</td>
                <td className="td">{r.supplier}</td>
                <td className="td">{r.cost_centre}</td>
                <td className="td text-right tabular-nums">{money(r.total)}</td>
                <td className="td text-right tabular-nums">{money(r.received_value)}</td>
                <td className="td text-right tabular-nums font-medium">{money(r.balance_value)}</td>
                <td className="td">{r.consumed ? <span className="badge bg-green-100 text-green-700">Received</span> : <span className="badge bg-amber-100 text-amber-700">Pending</span>}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={9}>Nothing here.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
