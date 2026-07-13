import { createClient } from "@/lib/supabase/server";
import NewBrnForm from "./NewBrnForm";

export const dynamic = "force-dynamic";

export default async function NewBrnPage() {
  const supabase = createClient();
  const [{ data: suppliers }, { data: companies }] = await Promise.all([
    supabase.from("parties").select("id, name").eq("party_type", "supplier").eq("is_active", true).order("name"),
    supabase.from("group_companies").select("id, name").eq("is_active", true).order("name"),
  ]);

  return <NewBrnForm suppliers={suppliers ?? []} companies={companies ?? []} />;
}
