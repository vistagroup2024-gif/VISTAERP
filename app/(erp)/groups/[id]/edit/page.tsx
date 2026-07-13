import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import GroupForm from "@/components/GroupForm";
import { Airport } from "@/components/AirportSelect";

export const dynamic = "force-dynamic";

export default async function EditGroupPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const [{ data: g }, { data: airports }, { data: agents }, { data: companies }] = await Promise.all([
    supabase.from("umrah_groups").select("*").eq("id", params.id).single(),
    supabase.from("airports").select("*").order("is_saudi", { ascending: false }).order("city"),
    supabase.from("parties").select("id, name").in("party_type", ["b2b_agent", "customer"]).eq("is_active", true).order("name"),
    supabase.from("companies").select("id, name").order("name"),
  ]);
  if (!g) notFound();

  return (
    <GroupForm
      airports={(airports ?? []) as Airport[]}
      agents={agents ?? []}
      companies={companies ?? []}
      existing={g}
    />
  );
}
