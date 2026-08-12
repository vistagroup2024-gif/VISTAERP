import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import NusukAgreementsTable from "./NusukAgreementsTable";

export const dynamic = "force-dynamic";

export default async function NusukAgreementsPage() {
  await guardStaffPage("hotels.bookings");
  const supabase = createClient();
  const [{ data: rows }, { data: companies }] = await Promise.all([
    supabase.rpc("nusuk_agreement_list"),
    supabase.from("group_companies").select("id, name").eq("is_active", true).order("name"),
  ]);
  return (
    <div>
      <RealtimeRefresh tables={["nusuk_agreements", "hotel_bookings"]} />
      <PageHeader title="Nusuk Agreements" />
      <NusukAgreementsTable rows={(rows ?? []) as any} companies={(companies ?? []) as any} />
    </div>
  );
}
