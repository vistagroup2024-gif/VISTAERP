import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import OperationsBoard from "./OperationsBoard";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import { getStaffAccess, staffCan } from "@/lib/staffSession";

export const dynamic = "force-dynamic";

export default async function OperationsPage({ searchParams }: { searchParams: { date?: string } }) {
  const sb = createClient();
  const access = await getStaffAccess();
  const canEdit = staffCan(access, "transport.bookings");
  const canAssign = staffCan(access, "transport.operations") || staffCan(access, "transport.driver_assign");
  const today = new Date().toISOString().slice(0, 10);
  const date = searchParams.date || today;

  const { data: trips } = await sb
    .from("transport_trip_sched")
    .select("id, booking_id, seq, route_id, route_label, route_name, vehicle_id, requested_vehicle_id, is_upgraded, is_outsourced, driver_id, vendor_id, trip_date, trip_time, pickup_location, drop_location, flight_no, status, sched_s, sched_e, drive_min, hajj_terminal, passenger_visa_type")
    .eq("trip_date", date)
    .order("trip_time");

  const bookingIds = Array.from(new Set((trips ?? []).map((t: any) => t.booking_id)));
  const tripIds = (trips ?? []).map((t: any) => t.id);
  // The scheduling view doesn't carry the outsourced-driver details; read them
  // from the base table so they can be shown/copied like an internal driver.
  const [{ data: bookings }, { data: drivers }, { data: vehicles }, { data: outsourceRows }] = await Promise.all([
    bookingIds.length ? sb.from("transport_bookings").select("id, booking_no, passenger_name, mobile, pax, booking_type, agent_id, status").in("id", bookingIds) : Promise.resolve({ data: [] as any[] }),
    sb.from("transport_drivers").select("id, name, mobile, license_no, vehicle_id, status").order("name"),
    sb.from("transport_vehicles").select("id, name, category, vehicle_type, is_active").order("name"),
    tripIds.length ? sb.from("transport_trips").select("id, outsource_driver_name, outsource_driver_mobile").in("id", tripIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  const odMap = new Map((outsourceRows ?? []).map((o: any) => [o.id, o]));
  const agentIds = Array.from(new Set((bookings ?? []).map((b: any) => b.agent_id).filter(Boolean)));
  const [{ data: vendors }, { data: agents }] = await Promise.all([
    sb.from("transport_vendors").select("id, name, vendor_type, contact_person, mobile").eq("is_active", true).order("name"),
    agentIds.length ? sb.from("parties").select("id, name").in("id", agentIds) : Promise.resolve({ data: [] as any[] }),
  ]);

  const bMap = new Map((bookings ?? []).map((b: any) => [b.id, b]));
  const dMap = new Map((drivers ?? []).map((d: any) => [d.id, d]));
  const vMap = new Map((vehicles ?? []).map((v: any) => [v.id, v]));
  const venMap = new Map((vendors ?? []).map((v: any) => [v.id, v.name]));
  const aMap = new Map((agents ?? []).map((a: any) => [a.id, a.name]));

  const enriched = (trips ?? []).map((t: any) => {
    const b = bMap.get(t.booking_id);
    const veh = t.vehicle_id ? vMap.get(t.vehicle_id) : null;
    const reqVeh = t.requested_vehicle_id ? vMap.get(t.requested_vehicle_id) : null;
    return {
      ...t,
      booking_no: b?.booking_no ?? null,
      passenger_name: b?.passenger_name ?? null,
      mobile: b?.mobile ?? null,
      pax: b?.pax ?? null,
      booking_type: b?.booking_type ?? null,
      agent_id: b?.agent_id ?? null,
      agent_name: b?.agent_id ? aMap.get(b.agent_id) ?? null : "Direct",
      route_display: t.route_name ?? t.route_label ?? "—",
      vehicle_name: veh?.name ?? null,
      vehicle_type: veh?.vehicle_type ?? veh?.category ?? null,
      vehicle_category: veh?.category ?? reqVeh?.category ?? null,
      requested_vehicle_name: reqVeh?.name ?? null,
      driver_name: t.driver_id ? dMap.get(t.driver_id)?.name ?? null : null,
      driver_mobile: t.driver_id ? dMap.get(t.driver_id)?.mobile ?? null : null,
      driver_reg: t.driver_id ? dMap.get(t.driver_id)?.license_no ?? null : null,
      hajj_terminal: t.hajj_terminal ?? false,
      vendor_name: t.vendor_id ? venMap.get(t.vendor_id) ?? null : null,
      outsource_driver_name: odMap.get(t.id)?.outsource_driver_name ?? null,
      outsource_driver_mobile: odMap.get(t.id)?.outsource_driver_mobile ?? null,
    };
  });

  return (
    <div className="max-w-[1400px]">
      <RealtimeRefresh tables={["transport_trips", "transport_bookings"]} pollMs={20000} />
      <PageHeader title="Operations" />
      <OperationsBoard
        date={date}
        today={today}
        trips={enriched}
        drivers={(drivers ?? []) as any[]}
        vehicles={(vehicles ?? []) as any[]}
        vendors={(vendors ?? []) as any[]}
        agents={((agents ?? []) as any[]).map((a) => ({ id: a.id, agency_name: a.name }))}
        canEdit={canEdit}
        canAssign={canAssign}
      />
    </div>
  );
}
