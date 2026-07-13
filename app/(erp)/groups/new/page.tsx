import { createClient } from "@/lib/supabase/server";
import NewGroupForm from "./NewGroupForm";
import { Airport } from "@/components/AirportSelect";

export const dynamic = "force-dynamic";

export default async function NewGroupPage() {
  const supabase = createClient();
  const [{ data: airports }, { data: agents }, { data: companies }] = await Promise.all([
    supabase.from("airports").select("*").order("is_saudi", { ascending: false }).order("city"),
    supabase.from("parties").select("id, name").in("party_type", ["b2b_agent", "customer"]).eq("is_active", true).order("name"),
    supabase.from("companies").select("id, name").order("name"),
  ]);

  return (
    <NewGroupForm
      airports={(airports ?? []) as Airport[]}
      agents={agents ?? []}
      companies={companies ?? []}
    />
  );
}
