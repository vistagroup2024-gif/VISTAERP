import { createClient } from "@/lib/supabase/server";
import { COMPANY_ID } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import LedgerReport from "./LedgerReport";

export const dynamic = "force-dynamic";

export default async function LedgerPage({ searchParams }: {
  searchParams: { account?: string; subtype?: string; from?: string; to?: string };
}) {
  const sb = createClient();
  // The whole chart, groups included: the picker needs the shape, not just the
  // postable leaves, because ticking a group is how you ask for all of it.
  const { data } = await sb.rpc("acct_tree", { p_company: COMPANY_ID });
  const nodes = (data ?? []) as any[];

  // A dashboard card ("Cash & Bank") doesn't name one account, it names a
  // SUBTYPE — and those accounts sit under three different groups (Cash in
  // Hand, Bank, Bank PKR), so no single group id would cover them. Resolved
  // here, against the same tree the picker already has, rather than a
  // separate lookup: every postable account of that subtype, ticked.
  const bySubtype = searchParams.subtype
    ? nodes.filter((n) => n.is_postable && searchParams.subtype!.split(",").includes(n.subtype)).map((n) => n.id)
    : [];
  const initialAccount = [searchParams.account, ...bySubtype].filter(Boolean).join(",") || undefined;

  return (
    <div className="space-y-4">
      <div className="no-print"><PageHeader title="Ledger" /></div>
      <LedgerReport nodes={nodes as any}
        initialAccount={initialAccount} initialFrom={searchParams.from} initialTo={searchParams.to} />
    </div>
  );
}
