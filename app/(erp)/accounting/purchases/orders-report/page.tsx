import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { COMPANY_ID } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import OrdersReportTable from "./OrdersReportTable";

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
  const lines = ((data as any)?.lines ?? []) as any[];
  const total = rows.reduce((s, r) => s + Number(r.total || 0), 0);
  const balance = rows.reduce((s, r) => s + Number(r.balance_value || 0), 0);

  return (
    <div className="space-y-4">
      <PageHeader title="Purchase Orders Report">
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
      <OrdersReportTable rows={rows as any} lines={lines as any} />
    </div>
  );
}
