import { createClient } from "@/lib/supabase/server";
import AgentForm from "../AgentForm";

export const dynamic = "force-dynamic";

export default async function NewAgentPage() {
  const supabase = createClient();
  const { data: companies } = await supabase.from("group_companies").select("id, name").eq("is_active", true).order("name");
  return <AgentForm companies={companies ?? []} />;
}
