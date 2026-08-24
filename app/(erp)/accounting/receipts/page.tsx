import { loadPickAccounts } from "@/lib/accounting";
import VoucherEditor from "@/components/accounting/VoucherEditor";

export const dynamic = "force-dynamic";

export default async function ReceiptsPage() {
  const { accounts, cashBank } = await loadPickAccounts();
  return <VoucherEditor kind="receipt" accounts={accounts} cashBank={cashBank} />;
}
