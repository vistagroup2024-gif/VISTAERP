import { createClient } from "@/lib/supabase/server";
import { COMPANY_ID } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import { loadPartyAccounts } from "@/lib/accounting";
import PdcClient from "./PdcClient";

export const dynamic = "force-dynamic";

export default async function PdcPage() {
  const sb = createClient();
  const [{ data: pdcs }, { data: bankAccs }, partyAccounts] = await Promise.all([
    sb.from("pdc_register")
      .select("id, direction, cheque_no, bank_name, amount_base, cheque_date, status, narration, party:accounts!party_account_id(code,name), bank:accounts!bank_account_id(code,name)")
      .order("created_at", { ascending: false }),
    sb.from("accounts").select("id, code, name, subtype").eq("is_postable", true).in("subtype", ["Cash", "Bank"]).order("code"),
    loadPartyAccounts(),
  ]);
  const list = (pdcs ?? []).map((p: any) => ({
    ...p, party: p.party ? p.party.name : null, bank: p.bank ? p.bank.name : null,
  }));

  return (
    <div className="space-y-4">
      <PageHeader title="PDC Register (Post-Dated Cheques)" />
      <PdcClient list={list as any} partyAccounts={partyAccounts as any} banks={(bankAccs ?? []) as any} />
    </div>
  );
}
