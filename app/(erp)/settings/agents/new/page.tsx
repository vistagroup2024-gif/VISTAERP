import { createClient } from "@/lib/supabase/server";
import AgentForm from "../AgentForm";

export const dynamic = "force-dynamic";

export default async function NewAgentPage() {
  const supabase = createClient();
  const { data: parties } = await supabase.from("parties")
    .select("id, name").in("party_type", ["customer", "b2b_agent"]).eq("is_active", true).order("name");
  return <AgentForm parties={parties ?? []} />;
}
