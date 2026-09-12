import { createClient } from "@/lib/supabase/server";
import { COMPANY_ID } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import AccountTree, { type AcctNode } from "@/components/accounting/AccountTree";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const supabase = createClient();
  const { data } = await supabase.rpc("acct_tree", { p_company: COMPANY_ID });
  const nodes = (data ?? []) as AcctNode[];

  // NO "New Account" BUTTON UP HERE. There used to be one, green, in the page
  // header — and the toolbar's "+ Add" / "+ Add Group" go to the very same
  // /accounting/accounts/new form. Two buttons, one destination. The toolbar
  // pair is the better of the two because they carry the selected row through
  // as ?parent=, so the new account lands inside the group you were looking at;
  // the header button always started at the top level. The tree masters had the
  // same duplicate pair and lost it for the same reason.
  return (
    <div>
      <PageHeader title="Chart of Accounts" />
      <AccountTree nodes={nodes} />
    </div>
  );
}
