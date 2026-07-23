import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import AgentForm from "../../AgentForm";

export const dynamic = "force-dynamic";

export default async function EditAgentPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const [{ data: agent }, { data: companies }] = await Promise.all([
    supabase.from("b2b_agents").select("*").eq("id", params.id).single(),
    supabase.from("group_companies").select("id, name").eq("is_active", true).order("name"),
  ]);
  if (!agent) notFound();
  return <AgentForm companies={companies ?? []} existing={agent} />;
}
