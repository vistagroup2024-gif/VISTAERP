import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import HotelBookingForm from "../HotelBookingForm";

export const dynamic = "force-dynamic";

export default async function NewHotelBookingPage() {
  await guardStaffPage("hotels.bookings");
  const supabase = createClient();
  const [{ data: hotels }, { data: agents }] = await Promise.all([
    supabase.from("hotels").select("id, name, city").eq("is_active", true).order("name"),
    supabase.from("parties").select("id, name").in("party_type", ["b2b_agent", "customer"]).eq("is_active", true).order("name"),
  ]);
  return (
    <div className="max-w-4xl">
      <PageHeader title="New Hotel Booking" />
      <HotelBookingForm existing={null} hotels={(hotels ?? []) as any} agents={(agents ?? []) as any} />
    </div>
  );
}
