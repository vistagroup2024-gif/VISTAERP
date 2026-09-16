import { createClient } from "@/lib/supabase/server";
import { COMPANY_ID } from "@/lib/format";
import { todaySA, monthStartSA } from "@/lib/saudiTime";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import DataTable from "@/components/reports/DataTable";
import TransactionsExport from "./TransactionsExport";

export const dynamic = "force-dynamic";
const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="card">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-bold ${tone ?? "text-slate-800"}`}>{value}</p>
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  gl_receipt: "Receipt", gl_payment: "Payment", purchase_voucher: "Purchase",
  car_sale: "Sale", car_scharge_month: "Sale (Service Charge)", journal: "Journal",
};

// Transactions Report — every posted journal line for the period.
// report_transactions() (migration 415) self-checks debit = credit across
// every line it returns, since that is true of every posted entry.
export default async function TransactionsReportPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  const sb = createClient();
  const from = searchParams.from || monthStartSA();
  const to = searchParams.to || todaySA();
  const { data } = await sb.rpc("report_transactions", { p_company: COMPANY_ID, p_from: from, p_to: to });
  const rows = ((data ?? []) as any[]).map((r) => ({ ...r, type: SOURCE_LABEL[r.source] ?? r.source }));

  const sumBy = (src: string) => rows.filter((r) => r.source === src).reduce((s, r) => s + Number(r.debit || 0) + Number(r.credit || 0), 0) / 2;
  const receipts = sumBy("gl_receipt");
  const payments = sumBy("gl_payment");
  const purchases = sumBy("purchase_voucher");
  const sales = rows.filter((r) => r.source === "car_sale" || r.source === "car_scharge_month")
    .reduce((s, r) => s + Number(r.debit || 0) + Number(r.credit || 0), 0) / 2;
  const journal = rows.filter((r) => r.source === "journal").reduce((s, r) => s + Number(r.debit || 0) + Number(r.credit || 0), 0) / 2;

  const cols = [
    { key: "voucher_no", label: "Voucher No" },
    { key: "date", label: "Date", kind: "date" as const },
    { key: "type", label: "Type" },
    { key: "account", label: "Account" },
    { key: "debit", label: "Debit", kind: "money" as const, total: true },
    { key: "credit", label: "Credit", kind: "money" as const, total: true },
    { key: "currency", label: "Currency" },
    { key: "cost_centre", label: "Cost Centre" },
    { key: "remarks", label: "Remarks" },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Transactions Report" subtitle="Every posted voucher line for the period, with account, debit/credit, currency and cost centre.">
        <PrintButton />
      </PageHeader>
      <form className="card flex flex-wrap items-end gap-3 print:hidden" method="get">
        <div><label className="label">From</label><input type="date" name="from" defaultValue={from} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={to} className="input" /></div>
        <button className="btn">Run</button>
      </form>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        <Kpi label="Receipts" value={money(receipts)} tone="text-green-700" />
        <Kpi label="Payments" value={money(payments)} tone="text-red-600" />
        <Kpi label="Net Difference" value={money(receipts - payments)} />
        <Kpi label="Purchases" value={money(purchases)} />
        <Kpi label="Sales" value={money(sales)} />
        <Kpi label="Journal Vouchers" value={money(journal)} />
      </div>

      <div className="flex justify-end print:hidden">
        <TransactionsExport cols={cols} rows={rows} />
      </div>
      <DataTable cols={cols} rows={rows} empty="No transactions in this period." />
    </div>
  );
}
