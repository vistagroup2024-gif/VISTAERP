import { loadPickAccounts } from "@/lib/accounting";
import { guardStaffPage, docRightsFor } from "@/lib/staffSession";
import VoucherEditor from "@/components/accounting/VoucherEditor";

export const dynamic = "force-dynamic";

export default async function ContraPage() {
  const access = await guardStaffPage("accounting.view", "contra");
  const { accounts, cashBank } = await loadPickAccounts();
  return <VoucherEditor kind="contra" accounts={accounts} cashBank={cashBank} rights={docRightsFor(access, "contra")} />;
}
