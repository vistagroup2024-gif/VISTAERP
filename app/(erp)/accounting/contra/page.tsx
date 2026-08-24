import { loadPickAccounts } from "@/lib/accounting";
import VoucherEditor from "@/components/accounting/VoucherEditor";

export const dynamic = "force-dynamic";

export default async function ContraPage() {
  const { accounts, cashBank } = await loadPickAccounts();
  return <VoucherEditor kind="contra" accounts={accounts} cashBank={cashBank} />;
}
