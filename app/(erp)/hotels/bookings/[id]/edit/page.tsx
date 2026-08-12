import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import HotelBookingForm from "../../HotelBookingForm";

export const dynamic = "force-dynamic";

export default async function EditHotelBookingPage({ params }: { params: { id: string } }) {
  await guardStaffPage("hotels.bookings");
  const supabase = createClient();
  const [{ data: b }, { data: stays }, { data: hotels }, { data: agents }, { data: suppliers }, { data: staff }] = await Promise.all([
    supabase.from("hotel_bookings").select("*").eq("id", params.id).single(),
    supabase.from("hotel_purchase_bookings").select("*").eq("booking_id", params.id).order("sort").order("created_at"),
    supabase.from("hotels").select("id, name, city").eq("is_active", true).order("name"),
    supabase.from("parties").select("id, name").in("party_type", ["b2b_agent", "customer"]).eq("is_active", true).order("name"),
    supabase.from("parties").select("id, name").eq("party_type", "supplier").eq("is_active", true).order("name"),
    supabase.rpc("staff_users_list"),
  ]);
  if (!b) notFound();
  const salespeople = Array.from(new Set((staff ?? []).map((u: any) => u.full_name ?? u.name ?? u.email).filter(Boolean))) as string[];
  return (
    <div className="max-w-4xl">
      <PageHeader title={`Edit ${b.booking_no}`} />
      <HotelBookingForm existing={b} stays={(stays ?? []) as any} hotels={(hotels ?? []) as any} agents={(agents ?? []) as any} suppliers={(suppliers ?? []) as any} salespeople={salespeople} />
    </div>
  );
}
