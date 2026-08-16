import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import HotelBookingsTable, { HRow } from "./HotelBookingsTable";
import { nightsBetween } from "../lib";

export const dynamic = "force-dynamic";

export default async function HotelBookingsPage() {
  await guardStaffPage("hotels.bookings");
  const supabase = createClient();
  const { data: bookings } = await supabase
    .from("hotel_bookings")
    .select("id, booking_no, booking_date, guest_name, group_no, guests, city, check_in, check_out, nights, rooms, status, hotel_name, parties:agent_id(name), hotels:hotel_id(name), hotel_purchase_bookings(id, hcn_status, hcn, vendor_status, hotel_name, city, check_in, check_out, rooms, meal_plan, room_type, sort, bill_id, supplier:supplier_id(name), hotels:hotel_id(name))")
    .order("created_at", { ascending: false })
    .limit(1000);

  // One row per stay so multi-stay bookings show each leg independently with its
  // own vendor/HCN status, supplier and payment state.
  const rows: HRow[] = [];
  for (const b of (bookings ?? []) as any[]) {
    const purch = ((b.hotel_purchase_bookings ?? []) as any[]).slice().sort((a, c) => (a.sort ?? 0) - (c.sort ?? 0));
    const legs = purch.length ? purch : [null];
    legs.forEach((p: any, i: number) => {
      const check_in = p?.check_in ?? b.check_in;
      const check_out = p?.check_out ?? b.check_out;
      rows.push({
        id: b.id,
        stay_id: p?.id ?? `${b.id}-${i}`,
        stay_index: i,
        stay_count: legs.length,
        booking_no: b.booking_no,
        booking_date: b.booking_date,
        guest_name: b.guest_name,
        group_no: b.group_no,
        guests: b.guests,
        agent: b.parties?.name ?? null,
        city: p?.city ?? b.city,
        hotel: p?.hotels?.name ?? p?.hotel_name ?? b.hotels?.name ?? b.hotel_name ?? null,
        check_in, check_out,
        nights: nightsBetween(check_in, check_out),
        rooms: p?.rooms ?? b.rooms,
        room_type: p?.room_type ?? null,
        meal_plan: p?.meal_plan ?? null,
        supplier: p?.supplier?.name ?? null,
        status: b.status,
        vendor_status: p?.vendor_status ?? "pending_purchase",
        hcn_status: p?.hcn_status ?? "pending",
        hcn: p?.hcn ?? null,
        payment: p?.bill_id ? "billed" : "none",
      });
    });
  }

  return (
    <div>
      <RealtimeRefresh tables={["hotel_bookings", "hotel_purchase_bookings"]} />
      <PageHeader title="Hotel Bookings" action={{ href: "/hotels/bookings/new", label: "+ New Hotel Booking" }} />
      <HotelBookingsTable rows={rows} />
    </div>
  );
}
