import { createClient } from "@/lib/supabase/server";
import { COMPANY_ID } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import LedgerReport from "./LedgerReport";

export const dynamic = "force-dynamic";

export default async function LedgerPage({ searchParams }: {
  searchParams: { account?: string; from?: string; to?: string };
}) {
  const sb = createClient();
  // The whole chart, groups included: the picker needs the shape, not just the
  // postable leaves, because ticking a group is how you ask for all of it.
  const { data } = await sb.rpc("acct_tree", { p_company: COMPANY_ID });

  return (
    <div className="space-y-4">
      <div className="no-print"><PageHeader title="Ledger" /></div>
      <LedgerReport nodes={(data ?? []) as any}
        initialAccount={searchParams.account} initialFrom={searchParams.from} initialTo={searchParams.to} />
    </div>
  );
}
