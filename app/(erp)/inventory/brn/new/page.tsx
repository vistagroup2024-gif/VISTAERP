import { createClient } from "@/lib/supabase/server";
import NewBrnForm from "./NewBrnForm";

export const dynamic = "force-dynamic";

export default async function NewBrnPage() {
  const supabase = createClient();
  const { data: suppliers } = await supabase
    .from("parties")
    .select("id, name")
    .eq("party_type", "supplier")
    .eq("is_active", true)
    .order("name");

  return <NewBrnForm suppliers={suppliers ?? []} />;
}
