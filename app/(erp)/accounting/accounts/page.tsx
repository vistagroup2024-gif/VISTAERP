import { createClient } from "@/lib/supabase/server";
import { COMPANY_ID } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import AccountTree, { type AcctNode } from "@/components/accounting/AccountTree";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const supabase = createClient();
  const { data } = await supabase.rpc("acct_tree", { p_company: COMPANY_ID });
  const nodes = (data ?? []) as AcctNode[];

  return (
    <div>
      <PageHeader title="Chart of Accounts" action={{ href: "/accounting/accounts/new", label: "New Account" }} />
      <AccountTree nodes={nodes} />
    </div>
  );
}
