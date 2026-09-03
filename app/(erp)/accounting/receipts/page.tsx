import { loadPickAccounts } from "@/lib/accounting";
import { guardStaffPage, docRightsFor } from "@/lib/staffSession";
import VoucherEditor from "@/components/accounting/VoucherEditor";

export const dynamic = "force-dynamic";

export default async function ReceiptsPage() {
  const access = await guardStaffPage("accounting.view", "receipt");
  const { accounts, cashBank } = await loadPickAccounts();
  return <VoucherEditor kind="receipt" accounts={accounts} cashBank={cashBank} rights={docRightsFor(access, "receipt")} />;
}
