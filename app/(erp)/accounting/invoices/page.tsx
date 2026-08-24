import { loadParties, loadIncomeExpenseAccounts } from "@/lib/accounting";
import InvoiceEditor from "./InvoiceEditor";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const [parties, accounts] = await Promise.all([loadParties(), loadIncomeExpenseAccounts()]);
  return <InvoiceEditor parties={parties as any} accounts={accounts} />;
}
