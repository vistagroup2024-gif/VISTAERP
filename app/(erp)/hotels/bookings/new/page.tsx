import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import HotelBookingForm from "../HotelBookingForm";

export const dynamic = "force-dynamic";

export default async function NewHotelBookingPage() {
  await guardStaffPage("hotels.bookings");
  const supabase = createClient();
  const [{ data: hotels }, { data: agents }, { data: suppliers }, { data: staff }] = await Promise.all([
    supabase.from("hotels").select("id, name, city").eq("is_active", true).order("name"),
    supabase.from("parties").select("id, name").in("party_type", ["b2b_agent", "customer"]).eq("is_active", true).order("name"),
    supabase.from("parties").select("id, name").eq("party_type", "supplier").eq("is_active", true).order("name"),
    supabase.rpc("staff_users_list"),
  ]);
  const salespeople = Array.from(new Set((staff ?? []).map((u: any) => u.full_name ?? u.name ?? u.email).filter(Boolean))) as string[];
  return (
    <div className="max-w-4xl">
      <PageHeader title="New Hotel Booking" />
      <HotelBookingForm existing={null} stays={[]} hotels={(hotels ?? []) as any} agents={(agents ?? []) as any} suppliers={(suppliers ?? []) as any} salespeople={salespeople} />
    </div>
  );
}
