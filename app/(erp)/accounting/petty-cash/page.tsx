import { loadPickAccounts } from "@/lib/accounting";
import VoucherEditor from "@/components/accounting/VoucherEditor";

export const dynamic = "force-dynamic";

export default async function PettyCashPage() {
  const { accounts, cashBank } = await loadPickAccounts();
  return <VoucherEditor kind="payment" accounts={accounts} cashBank={cashBank}
    variant={{ source: "gl_petty", title: "Petty Cash Voucher", postRpc: "gl_petty",
      cashLabel: "Petty Cash A/c", cashMatch: "PETTY" }} />;
}
