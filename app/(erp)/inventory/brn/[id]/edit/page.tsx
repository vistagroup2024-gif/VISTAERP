import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import BrnEditForm from "./BrnEditForm";

export const dynamic = "force-dynamic";

export default async function EditBrnPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const [{ data: brn }, { data: suppliers }, { data: companies }, { count }] = await Promise.all([
    supabase.from("brn_inventory").select("*").eq("id", params.id).single(),
    supabase.from("parties").select("id, name").eq("party_type", "supplier").eq("is_active", true).order("name"),
    supabase.from("group_companies").select("id, name").eq("is_active", true).order("name"),
    supabase.from("brn_consumption").select("id", { count: "exact", head: true }).eq("brn_id", params.id),
  ]);
  if (!brn) notFound();

  return <BrnEditForm brn={brn} suppliers={suppliers ?? []} companies={companies ?? []} consumedCount={count ?? 0} />;
}
