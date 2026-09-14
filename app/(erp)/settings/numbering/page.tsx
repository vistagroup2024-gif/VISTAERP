import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import NumberingManager from "./NumberingManager";

export const dynamic = "force-dynamic";

// Every number series the ERP issues, on one screen: prefix, digits, the next
// number, and whether a trade voucher's ledger entry carries the document's own
// number. The database issues numbers from doc_sequences; this is the one place
// those rows are set by hand.
export default async function NumberingPage() {
  await guardStaffPage("system.config");
  const sb = createClient();
  const { data } = await sb.rpc("doc_sequences_list");
  const d = (data as any) ?? {};
  return (
    <div className="max-w-5xl">
      <PageHeader title="Voucher Numbering" />
      <NumberingManager rows={(d.rows as any[]) ?? []} ledgerUsesDocNo={!!d.ledger_uses_doc_no} />
    </div>
  );
}
