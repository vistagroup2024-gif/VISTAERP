import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PartyForm from "@/components/PartyForm";

export const dynamic = "force-dynamic";

export default async function EditPartyPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: party } = await supabase
    .from("parties")
    .select("id, party_type, name, code, phone, email, currency, credit_limit, credit_days, sales_target")
    .eq("id", params.id)
    .single();
  if (!party) notFound();
  return <PartyForm existing={party} />;
}
