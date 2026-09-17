import { createClient } from "@/lib/supabase/server";
import { COMPANY_ID } from "@/lib/format";
import { todaySA, monthStartSA } from "@/lib/saudiTime";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import DataTable from "@/components/reports/DataTable";
import ReportKpi from "@/components/reports/ReportKpi";
import TransactionsExport from "./TransactionsExport";
import TransactionsFilters from "./TransactionsFilters";

export const dynamic = "force-dynamic";
const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);

const SOURCE_LABEL: Record<string, string> = {
  gl_receipt: "Receipt", gl_payment: "Payment", purchase_voucher: "Purchase",
  car_sale: "Sale", car_scharge_month: "Sale (Service Charge)", journal: "Journal",
};

// Transactions Report — every posted journal line for the period.
// report_transactions() (migration 415) self-checks debit = credit across
// every line it returns, since that is true of every posted entry. It has
// always accepted p_account_ids/p_cost_centres/p_txn_type; this page now
// actually exposes them (TransactionsFilters), links Voucher No/Account
// through to that account's ledger for the period (the same drill-down
// pattern the P&L already uses), and derives "Other Side" per line by
// grouping same-entry_id rows — a receipt's debit leg now shows which
// account its credit leg landed on, and vice versa, without assuming every
// entry is exactly two lines.
export default async function TransactionsReportPage({ searchParams }: { searchParams: { from?: string; to?: string; account?: string; cc?: string; type?: string } }) {
  const sb = createClient();
  const from = searchParams.from || monthStartSA();
  const to = searchParams.to || todaySA();
  const accountIds = searchParams.account ? searchParams.account.split(",").filter(Boolean) : [];
  const costCentres = searchParams.cc ? searchParams.cc.split(",").filter(Boolean) : [];
  const txnTypes = searchParams.type ? searchParams.type.split(",").filter(Boolean) : [];

  const { data } = await sb.rpc("report_transactions", {
    p_company: COMPANY_ID, p_from: from, p_to: to,
    p_account_ids: accountIds.length ? accountIds : null,
    p_cost_centres: costCentres.length ? costCentres : null,
    p_txn_type: txnTypes.length ? txnTypes : null,
  });
  const raw = (data ?? []) as any[];

  // Other side: every other account on the same entry, comma-joined — works
  // for a simple two-line voucher and a multi-line one alike.
  const accountsByEntry = new Map<string, string[]>();
  for (const r of raw) {
    if (!accountsByEntry.has(r.entry_id)) accountsByEntry.set(r.entry_id, []);
    accountsByEntry.get(r.entry_id)!.push(r.account);
  }
  const rows = raw.map((r) => ({
    ...r,
    type: SOURCE_LABEL[r.source] ?? r.source,
    other_side: (accountsByEntry.get(r.entry_id) ?? []).filter((a) => a !== r.account).join(", ") || "—",
  }));

  const sumBy = (src: string) => rows.filter((r) => r.source === src).reduce((s, r) => s + Number(r.debit || 0) + Number(r.credit || 0), 0) / 2;
  const receipts = sumBy("gl_receipt");
  const payments = sumBy("gl_payment");
  const purchases = sumBy("purchase_voucher");
  const sales = rows.filter((r) => r.source === "car_sale" || r.source === "car_scharge_month")
    .reduce((s, r) => s + Number(r.debit || 0) + Number(r.credit || 0), 0) / 2;
  const journal = rows.filter((r) => r.source === "journal").reduce((s, r) => s + Number(r.debit || 0) + Number(r.credit || 0), 0) / 2;

  const ledgerHref = (r: any) => r.account_id ? `/accounting/ledger?account=${r.account_id}&from=${from}&to=${to}` : null;
  const cols = [
    { key: "voucher_no", label: "Voucher No", href: ledgerHref },
    { key: "date", label: "Date", kind: "date" as const },
    { key: "type", label: "Type" },
    { key: "account", label: "Account", href: ledgerHref },
    { key: "debit", label: "Debit", kind: "money" as const, total: true },
    { key: "credit", label: "Credit", kind: "money" as const, total: true },
    { key: "other_side", label: "Other Side" },
    { key: "currency", label: "Currency" },
    { key: "cost_centre", label: "Cost Centre" },
    { key: "remarks", label: "Remarks" },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Transactions Report" subtitle="Every posted voucher line for the period, with account, debit/credit, currency and cost centre.">
        <PrintButton />
      </PageHeader>
      <TransactionsFilters account={accountIds} cc={costCentres} type={txnTypes} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        <ReportKpi label="Receipts" value={money(receipts)} icon="receipt" tone="pos" />
        <ReportKpi label="Payments" value={money(payments)} icon="receipt" tone="neg" />
        <ReportKpi label="Net Difference" value={money(receipts - payments)} icon="wallet" />
        <ReportKpi label="Purchases" value={money(purchases)} icon="purchase" />
        <ReportKpi label="Sales" value={money(sales)} icon="sales" />
        <ReportKpi label="Journal Vouchers" value={money(journal)} icon="accounting" />
      </div>

      <div className="flex justify-end print:hidden">
        <TransactionsExport cols={cols} rows={rows} />
      </div>
      <DataTable cols={cols} rows={rows} empty="No transactions in this period." />
    </div>
  );
}
