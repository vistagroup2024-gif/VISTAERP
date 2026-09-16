import { createClient } from "@/lib/supabase/server";
import { COMPANY_ID, dateStr } from "@/lib/format";
import { todaySA, yearSA } from "@/lib/saudiTime";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import TrendChart from "@/components/reports/charts/TrendChart";
import DataTable from "@/components/reports/DataTable";

export const dynamic = "force-dynamic";
const money = (n: any) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-bold text-slate-800">{value}</p>
    </div>
  );
}

// Drawings Report — report_drawings() (migration 416), the DRAWING account
// group (subtype 'Drawing') the chart of accounts already has.
export default async function DrawingsReportPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  const sb = createClient();
  const from = searchParams.from || `${yearSA()}-01-01`;
  const to = searchParams.to || todaySA();
  const { data } = await sb.rpc("report_drawings", { p_company: COMPANY_ID, p_from: from, p_to: to });
  const d = (data as any) ?? { total: 0, by_account: [], monthly: [], rows: [] };
  const avgMonthly = d.monthly.length > 0 ? Number(d.total) / d.monthly.length : 0;

  return (
    <div className="space-y-4">
      <PageHeader title="Drawings Report" subtitle="Owner drawings by account, for the chosen period.">
        <PrintButton />
      </PageHeader>
      <form className="card flex flex-wrap items-end gap-3 print:hidden" method="get">
        <div><label className="label">From</label><input type="date" name="from" defaultValue={from} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={to} className="input" /></div>
        <button className="btn">Run</button>
      </form>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Kpi label="Total Drawings" value={money(d.total)} />
        <Kpi label="Monthly Average" value={money(avgMonthly)} />
        <Kpi label="Drawing Accounts" value={String(d.by_account.length)} />
      </div>

      {d.monthly.length > 1 && (
        <div className="card">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Monthly Trend</h2>
          <TrendChart data={d.monthly} xKey="month" series={[{ key: "amount", label: "Drawings" }]} />
        </div>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">By Account</h2>
        <DataTable
          cols={[
            { key: "name", label: "Drawing Account", href: (r: any) => r.account_id ? `/accounting/ledger?account=${r.account_id}&from=${from}&to=${to}` : null },
            { key: "amount", label: "Amount", kind: "money", total: true },
          ]}
          rows={d.by_account} empty="No drawings in this period." />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Vouchers</h2>
        <DataTable
          cols={[
            { key: "voucher", label: "Voucher" },
            { key: "date", label: "Date", kind: "date" },
            { key: "account", label: "Drawing Account", href: (r: any) => r.account_id ? `/accounting/ledger?account=${r.account_id}&from=${from}&to=${to}` : null },
            { key: "credit_account", label: "Credit Account" },
            { key: "amount", label: "Amount", kind: "money", total: true },
            { key: "remarks", label: "Remarks" },
          ]}
          rows={d.rows} empty="No drawing vouchers in this period." />
      </div>
    </div>
  );
}
