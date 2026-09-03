import { loadPickAccounts } from "@/lib/accounting";
import { guardStaffPage, docRightsFor } from "@/lib/staffSession";
import VoucherEditor from "@/components/accounting/VoucherEditor";

export const dynamic = "force-dynamic";

export default async function PettyCashPage() {
  const access = await guardStaffPage("accounting.view", "petty_cash");
  const { accounts, cashBank } = await loadPickAccounts();
  return <VoucherEditor kind="payment" accounts={accounts} cashBank={cashBank} rights={docRightsFor(access, "petty_cash")}
    variant={{ source: "gl_petty", title: "Petty Cash Voucher", postRpc: "gl_petty",
      cashLabel: "Petty Cash A/c", cashMatch: "PETTY" }} />;
}
