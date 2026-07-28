import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import OperationsBoard from "./OperationsBoard";

export const dynamic = "force-dynamic";

export default async function OperationsPage({ searchParams }: { searchParams: { date?: string } }) {
  const sb = createClient();
  const today = new Date().toISOString().slice(0, 10);
  const date = searchParams.date || today;

  const { data: trips } = await sb
    .from("transport_trip_sched")
    .select("id, booking_id, seq, route_id, route_label, route_name, vehicle_id, requested_vehicle_id, is_upgraded, driver_id, vendor_id, trip_time, pickup_location, drop_location, status, sched_s, sched_e, drive_min")
    .eq("trip_date", date)
    .order("trip_time");

  const bookingIds = Array.from(new Set((trips ?? []).map((t: any) => t.booking_id)));
  const [{ data: bookings }, { data: drivers }, { data: vehicles }] = await Promise.all([
    bookingIds.length ? sb.from("transport_bookings").select("id, booking_no, passenger_name, mobile, status").in("id", bookingIds) : Promise.resolve({ data: [] as any[] }),
    sb.from("transport_drivers").select("id, name, vehicle_id, status, shift_start, shift_end").order("name"),
    sb.from("transport_vehicles").select("id, name, is_active").order("name"),
  ]);
  const { data: vendors } = await sb.from("transport_vendors").select("id, name").eq("is_active", true).order("name");

  const bMap = new Map((bookings ?? []).map((b: any) => [b.id, b]));
  const dMap = new Map((drivers ?? []).map((d: any) => [d.id, d]));
  const vMap = new Map((vehicles ?? []).map((v: any) => [v.id, v]));
  const venMap = new Map((vendors ?? []).map((v: any) => [v.id, v.name]));

  const enriched = (trips ?? []).map((t: any) => {
    const b = bMap.get(t.booking_id);
    return {
      ...t,
      booking_no: b?.booking_no ?? null,
      passenger_name: b?.passenger_name ?? null,
      mobile: b?.mobile ?? null,
      route_display: t.route_name ?? t.route_label ?? "—",
      vehicle_name: t.vehicle_id ? vMap.get(t.vehicle_id)?.name ?? null : null,
      requested_vehicle_name: t.requested_vehicle_id ? vMap.get(t.requested_vehicle_id)?.name ?? null : null,
      driver_name: t.driver_id ? dMap.get(t.driver_id)?.name ?? null : null,
      vendor_name: t.vendor_id ? venMap.get(t.vendor_id) ?? null : null,
    };
  });

  return (
    <div className="max-w-6xl">
      <PageHeader title="Operations" />
      <OperationsBoard
        date={date}
        today={today}
        trips={enriched}
        drivers={(drivers ?? []) as any[]}
        vehicles={(vehicles ?? []) as any[]}
        vendors={(vendors ?? []) as any[]}
      />
    </div>
  );
}
