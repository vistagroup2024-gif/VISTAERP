import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import HotelBookingsTable, { HRow } from "./HotelBookingsTable";
import { aggregateHcnStage } from "../lib";

export const dynamic = "force-dynamic";

export default async function HotelBookingsPage() {
  await guardStaffPage("hotels.bookings");
  const supabase = createClient();
  const { data: bookings } = await supabase
    .from("hotel_bookings")
    .select("id, booking_no, booking_date, guest_name, group_no, city, check_in, check_out, nights, rooms, status, hotel_name, parties:agent_id(name), hotels:hotel_id(name), hotel_purchase_bookings(hcn_status, bill_id, supplier:supplier_id(name))")
    .order("created_at", { ascending: false })
    .limit(1000);

  const rows: HRow[] = (bookings ?? []).map((b: any) => {
    const purch = (b.hotel_purchase_bookings ?? []) as any[];
    const hcnStage = aggregateHcnStage(purch.map((p) => p.hcn_status).filter(Boolean));
    const hasBill = purch.some((p) => p.bill_id);
    const suppliers = Array.from(new Set(purch.map((p) => p.supplier?.name).filter(Boolean)));
    const supplier = suppliers.length > 1 ? `${suppliers[0]} +${suppliers.length - 1}` : (suppliers[0] ?? null);
    return {
      id: b.id, booking_no: b.booking_no, booking_date: b.booking_date, guest_name: b.guest_name, group_no: b.group_no,
      agent: b.parties?.name ?? null, city: b.city, hotel: b.hotels?.name ?? b.hotel_name ?? null,
      check_in: b.check_in, check_out: b.check_out, nights: b.nights, rooms: b.rooms, supplier,
      status: b.status, hcn_status: hcnStage, payment: hasBill ? "billed" : "none",
    };
  });

  return (
    <div>
      <RealtimeRefresh tables={["hotel_bookings", "hotel_purchase_bookings"]} />
      <PageHeader title="Hotel Bookings" action={{ href: "/hotels/bookings/new", label: "+ New Hotel Booking" }} />
      <HotelBookingsTable rows={rows} />
    </div>
  );
}
