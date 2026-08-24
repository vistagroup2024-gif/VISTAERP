import { loadPickAccounts } from "@/lib/accounting";
import VoucherEditor from "@/components/accounting/VoucherEditor";

export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  const { accounts, cashBank } = await loadPickAccounts();
  return <VoucherEditor kind="payment" accounts={accounts} cashBank={cashBank} />;
}
