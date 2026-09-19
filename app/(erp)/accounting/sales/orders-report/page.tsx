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

// Sale Order has never had a list screen — a clerk finds one by typing its
// number into the header's own Document No. box. This report is the one for
// browsing/analysing rather than finding a specific number: report_sale_orders()
// (migration 411), Pending / History / All — three exclusive tabs (the same
// shape accounting/approvals/page.tsx already uses correctly), not a
// multi-select: Pending and History are mutually exclusive states of the
// same order, never something a user wants to see two slices of at once
// (unlike, say, Sales Report's "View By"), so All is its own button rather
// than an emergent "both toggled on" state. That additive-toggle shape was
// tried first and was the bug: clicking History from the default
// Pending-only selection ADDED history to the set instead of replacing it,
// jumping straight to "all" (both sections' rows) on the very first click
// away from the default. Rows open the real voucher editor via ?id=.
const TABS = [["pending", "Pending"], ["history", "History"], ["all", "All"]] as const;

export default async function SalesOrdersReportPage({ searchParams }: { searchParams: { status?: string } }) {
  const sb = createClient();
  const status = searchParams.status === "history" || searchParams.status === "all" ? searchParams.status : "pending";
  const { data } = await sb.rpc("report_sale_orders", { p_company: COMPANY_ID, p_status: status });
  const rows = ((data as any)?.rows ?? []) as any[];
  const lines = ((data as any)?.lines ?? []) as any[];
  const total = rows.reduce((s, r) => s + Number(r.total || 0), 0);
  const advPending = rows.reduce((s, r) => s + Math.max(0, Number(r.advance_balance || 0)), 0);

  return (
    <div className="space-y-4">
      <PageHeader title="Sales Orders Report">
        <PrintButton />
      </PageHeader>
      <div className="flex gap-2 print:hidden">
        {TABS.map(([k, label]) => (
          <Link key={k} href={`/accounting/sales/orders-report?status=${k}`}
            className={`rounded-full px-3 py-1 text-sm ${status === k ? "bg-brand text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            {label}
          </Link>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Orders" value={String(rows.length)} />
        <Kpi label="Total Value" value={money(total)} />
        <Kpi label="Advance Pending" value={money(advPending)} tone={advPending > 0 ? "text-amber-700" : "text-green-700"} />
      </div>
      <OrdersReportTable rows={rows as any} lines={lines as any} />
    </div>
  );
}
