import { createClient } from "@/lib/supabase/server";
import { COMPANY_ID } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import CloseClient from "./CloseClient";

export const dynamic = "force-dynamic";

export default async function ClosePage() {
  const sb = createClient();
  const { data } = await sb.from("acct_settings").select("closed_through").eq("company_id", COMPANY_ID).maybeSingle();
  return (
    <div className="space-y-4">
      <PageHeader title="Year-End Close & Period Lock" />
      <CloseClient closedThrough={(data as any)?.closed_through ?? null} />
    </div>
  );
}
