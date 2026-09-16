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

// Same pending Sale Orders report_sale_orders() already returns (migration
// 411), split by whether the advance agreed on the order has fully come in —
// the dashboard's Sale Order · Advance vs Receipt card's detail screen.
export default async function AdvanceVsReceiptPage() {
  const sb = createClient();
  const { data } = await sb.rpc("report_sale_orders", { p_company: COMPANY_ID, p_status: "pending" });
  const rows = ((data as any)?.rows ?? []) as any[];
  const withAdvance = rows.filter((r) => Number(r.advance || 0) > 0);
  const pending = withAdvance.filter((r) => Number(r.advance_balance || 0) > 0.005);
  const received = withAdvance.filter((r) => Number(r.advance_balance || 0) <= 0.005);

  const total = rows.reduce((s, r) => s + Number(r.total || 0), 0);
  const advReceived = withAdvance.reduce((s, r) => s + Number(r.advance_received || 0), 0);
  const advPending = pending.reduce((s, r) => s + Number(r.advance_balance || 0), 0);

  const Table = ({ title, list }: { title: string; list: any[] }) => (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-slate-700">{title} ({list.length})</h2>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-slate-50"><tr>
            <th className="th">Order No</th><th className="th">Date</th><th className="th">Customer</th><th className="th">Cost Centre</th>
            <th className="th text-right">SO Amount</th><th className="th text-right">Advance</th>
            <th className="th text-right">Received</th><th className="th text-right">Balance</th>
          </tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.doc_id} className="border-t border-slate-100">
                <td className="td"><Link href={`/accounting/sales/orders?id=${r.doc_id}`} className="text-brand hover:underline">{r.doc_no}</Link></td>
                <td className="td">{dateStr(r.doc_date)}</td>
                <td className="td">{r.customer}</td>
                <td className="td">{r.cost_centre}</td>
                <td className="td text-right tabular-nums">{money(r.total)}</td>
                <td className="td text-right tabular-nums">{money(r.advance)}</td>
                <td className="td text-right tabular-nums">{money(r.advance_received)}</td>
                <td className="td text-right tabular-nums font-medium">{money(r.advance_balance)}</td>
              </tr>
            ))}
            {list.length === 0 && <tr><td className="td text-slate-400" colSpan={8}>None.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Sale Order · Advance vs Receipt" subtitle="Pending Sale Orders with an agreed advance, split by whether that advance has fully come in.">
        <PrintButton />
      </PageHeader>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Kpi label="Pending Orders" value={String(rows.length)} />
        <Kpi label="Total Order Value" value={money(total)} />
        <Kpi label="Advance Received" value={money(advReceived)} tone="text-green-700" />
        <Kpi label="Advance Pending" value={money(advPending)} tone={advPending > 0 ? "text-amber-700" : "text-green-700"} />
        <Kpi label="Fully Received" value={String(received.length)} />
      </div>
      <Table title="Advance Pending" list={pending} />
      <Table title="Advance Fully Received" list={received} />
    </div>
  );
}
