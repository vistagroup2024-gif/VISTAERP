import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { COMPANY_ID } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import ApprovalList from "./ApprovalList";

export const dynamic = "force-dynamic";

const TABS = [["pending", "Pending"], ["authorized", "Authorized"], ["rejected", "Rejected"], ["all", "All"]] as const;

export default async function ApprovalsPage({ searchParams }: { searchParams: { status?: string } }) {
  const sb = createClient();
  const status = searchParams.status ?? "pending";
  const [{ data: items }, { data: canAuth }] = await Promise.all([
    sb.rpc("pending_inbox", { p_company: COMPANY_ID, p_status: status }),
    sb.rpc("acct_can_authorize"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader title="Approval Inbox" />
      <div className="flex gap-2">
        {TABS.map(([k, label]) => (
          <Link key={k} href={`/accounting/approvals?status=${k}`}
            className={`rounded-full px-3 py-1 text-sm ${status === k ? "bg-brand text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            {label}
          </Link>
        ))}
      </div>
      {!canAuth && status === "pending" && (
        <div className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-700">You can view pending vouchers but don’t have the <b>accounting.authorize</b> permission to approve them.</div>
      )}
      <ApprovalList items={(items ?? []) as any} canAuthorize={!!canAuth} />
    </div>
  );
}
