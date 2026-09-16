import { createClient } from "@/lib/supabase/server";
import { COMPANY_ID } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import AdvanceReceiptTable from "./AdvanceReceiptTable";

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

const STATUS_OPTS: [string, string][] = [["pending", "Pending Orders"], ["history", "Invoiced Orders"], ["all", "All Orders"]];

// report_sale_orders() (migration 411, extended 426 with the actual receipt
// rows behind each order's "Received") split by whether the advance agreed
// on the order has fully come in — the dashboard's Sale Order · Advance vs
// Receipt card's detail screen. Status defaults to "pending" (the card's own
// scope) but is now a real filter, and a date-range narrows by order date —
// neither existed before, so the screen could only ever show today's open
// orders and never the history behind a closed one.
export default async function AdvanceVsReceiptPage({ searchParams }: { searchParams: { status?: string; from?: string; to?: string } }) {
  const sb = createClient();
  const status = STATUS_OPTS.some(([k]) => k === searchParams.status) ? searchParams.status! : "pending";
  const from = searchParams.from || "";
  const to = searchParams.to || "";
  const { data } = await sb.rpc("report_sale_orders", { p_company: COMPANY_ID, p_status: status });
  const allRows = ((data as any)?.rows ?? []) as any[];
  const receipts = ((data as any)?.receipts ?? []) as any[];
  const rows = allRows.filter((r) => (!from || r.doc_date >= from) && (!to || r.doc_date <= to));
  const withAdvance = rows.filter((r) => Number(r.advance || 0) > 0);
  const pending = withAdvance.filter((r) => Number(r.advance_balance || 0) > 0.005);
  const received = withAdvance.filter((r) => Number(r.advance_balance || 0) <= 0.005);

  const total = rows.reduce((s, r) => s + Number(r.total || 0), 0);
  const advReceived = withAdvance.reduce((s, r) => s + Number(r.advance_received || 0), 0);
  const advPending = pending.reduce((s, r) => s + Number(r.advance_balance || 0), 0);

  return (
    <div className="space-y-4">
      <PageHeader title="Sale Order · Advance vs Receipt" subtitle="Sale Orders with an agreed advance, split by whether that advance has fully come in — expand a row for the receipt(s) behind it.">
        <PrintButton />
      </PageHeader>
      <form className="card flex flex-wrap items-end gap-3 print:hidden" method="get">
        <div>
          <label className="label">Orders</label>
          <select name="status" defaultValue={status} className="input">
            {STATUS_OPTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div><label className="label">Order Date From</label><input type="date" name="from" defaultValue={from} className="input" /></div>
        <div><label className="label">Order Date To</label><input type="date" name="to" defaultValue={to} className="input" /></div>
        <button className="btn">Run</button>
      </form>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Kpi label="Orders" value={String(rows.length)} />
        <Kpi label="Total Order Value" value={money(total)} />
        <Kpi label="Advance Received" value={money(advReceived)} tone="text-green-700" />
        <Kpi label="Advance Pending" value={money(advPending)} tone={advPending > 0 ? "text-amber-700" : "text-green-700"} />
        <Kpi label="Fully Received" value={String(received.length)} />
      </div>
      <AdvanceReceiptTable title="Advance Pending" rows={pending} receipts={receipts} />
      <AdvanceReceiptTable title="Advance Fully Received" rows={received} receipts={receipts} />
    </div>
  );
}
