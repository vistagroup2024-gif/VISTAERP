import PageHeader from "@/components/PageHeader";
import ReportRunner from "@/components/reports/ReportRunner";
import { ACCOUNTING_REPORTS } from "@/lib/reports/accounting";

export const dynamic = "force-dynamic";

const CFG = ACCOUNTING_REPORTS.cash_bank;

export default function CashBankPage() {
  return (
    <div>
      <PageHeader title={CFG.title} subtitle={CFG.subtitle} />
      <ReportRunner registry={ACCOUNTING_REPORTS} report="cash_bank" />
    </div>
  );
}
