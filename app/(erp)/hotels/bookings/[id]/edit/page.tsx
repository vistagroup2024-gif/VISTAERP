import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import HotelBookingForm from "../../HotelBookingForm";

export const dynamic = "force-dynamic";

export default async function EditHotelBookingPage({ params }: { params: { id: string } }) {
  await guardStaffPage("hotels.bookings");
  const supabase = createClient();
  const [{ data: b }, { data: hotels }, { data: agents }] = await Promise.all([
    supabase.from("hotel_bookings").select("*").eq("id", params.id).single(),
    supabase.from("hotels").select("id, name, city").eq("is_active", true).order("name"),
    supabase.from("parties").select("id, name").in("party_type", ["b2b_agent", "customer"]).eq("is_active", true).order("name"),
  ]);
  if (!b) notFound();
  return (
    <div className="max-w-4xl">
      <PageHeader title={`Edit ${b.booking_no}`} />
      <HotelBookingForm existing={b} hotels={(hotels ?? []) as any} agents={(agents ?? []) as any} />
    </div>
  );
}
