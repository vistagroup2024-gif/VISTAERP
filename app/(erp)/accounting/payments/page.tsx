import { loadPickAccounts } from "@/lib/accounting";
import { guardStaffPage, docRightsFor } from "@/lib/staffSession";
import VoucherEditor from "@/components/accounting/VoucherEditor";

export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  const access = await guardStaffPage("accounting.view", "payment");
  const { accounts, cashBank } = await loadPickAccounts();
  return <VoucherEditor kind="payment" accounts={accounts} cashBank={cashBank} rights={docRightsFor(access, "payment")} />;
}
