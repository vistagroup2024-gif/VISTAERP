import { loadPickAccounts } from "@/lib/accounting";
import VoucherEditor from "@/components/accounting/VoucherEditor";

export const dynamic = "force-dynamic";

export default async function CommissionPage() {
  const { accounts, cashBank } = await loadPickAccounts();
  return <VoucherEditor kind="payment" accounts={accounts} cashBank={cashBank}
    variant={{ source: "gl_commission", title: "Commission Voucher", postRpc: "gl_commission",
      lineLabel: "Salesperson / Commission A/c" }} />;
}
