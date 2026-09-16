import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import { ACCOUNTING_REPORTS } from "@/lib/reports/accounting";
import CashBankView from "./CashBankView";

export const dynamic = "force-dynamic";

const CFG = ACCOUNTING_REPORTS.cash_bank;

export default function CashBankPage() {
  return (
    <div>
      <PageHeader title={CFG.title} subtitle={CFG.subtitle}>
        <PrintButton />
      </PageHeader>
      <CashBankView />
    </div>
  );
}
