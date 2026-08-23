import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import OperationsBoard from "./OperationsBoard";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import { getStaffAccess, staffCan } from "@/lib/staffSession";
import { distributeWhole } from "@/lib/transportFare";

export const dynamic = "force-dynamic";

export default async function OperationsPage({ searchParams }: { searchParams: { date?: string } }) {
  const sb = createClient();
  const access = await getStaffAccess();
  const canEdit = staffCan(access, "transport.bookings");
  const canAssign = staffCan(access, "transport.operations") || staffCan(access, "transport.driver_assign");
  const today = new Date().toISOString().slice(0, 10);
  const date = searchParams.date || today;

  // These four don't depend on the trips result, so fire them in parallel with it
  // instead of waiting — cuts the page's sequential Supabase round-trips.
  const [{ data: trips }, { data: drivers }, { data: vehicles }, { data: vendors }, { data: extraRates }] = await Promise.all([
    sb.from("transport_trip_sched")
      .select("id, booking_id, seq, route_id, route_label, route_name, vehicle_id, requested_vehicle_id, is_upgraded, is_outsourced, driver_id, vendor_id, trip_date, trip_time, pickup_location, drop_location, flight_no, status, sched_s, sched_e, drive_min, hajj_terminal, passenger_visa_type")
      .eq("trip_date", date).order("trip_time"),
    sb.from("transport_drivers").select("id, name, mobile, license_no, vehicle_id, status").order("name"),
    sb.from("transport_vehicles").select("id, name, category, vehicle_type, upgrade_rank, is_active").order("name"),
    sb.from("transport_vendors").select("id, name, vendor_type, contact_person, mobile, vehicle_ids").eq("is_active", true).order("name"),
    sb.from("transport_route_rates").select("route_id, vehicle_id, extra_charge_amount, created_at").eq("extra_charge_enabled", true).order("created_at", { ascending: false }),
  ]);

  const bookingIds = Array.from(new Set((trips ?? []).map((t: any) => t.booking_id)));
  const tripIds = (trips ?? []).map((t: any) => t.id);
  // Only these two genuinely depend on the trip/booking ids from above.
  const [{ data: bookings }, { data: outsourceRows }] = await Promise.all([
    bookingIds.length ? sb.from("transport_bookings").select("id, booking_no, passenger_name, mobile, whatsapp, pax, booking_type, agent_id, status, payment_method, sell_amount, net_amount, surcharge_amount, collect_amount").in("id", bookingIds) : Promise.resolve({ data: [] as any[] }),
    tripIds.length ? sb.from("transport_trips").select("id, outsource_driver_name, outsource_driver_mobile, sell_rate, vendor_cost, tafweej_created, cash_received, assignment_confirmed").in("id", tripIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  const odMap = new Map((outsourceRows ?? []).map((o: any) => [o.id, o]));
  const agentIds = Array.from(new Set((bookings ?? []).map((b: any) => b.agent_id).filter(Boolean)));
  const { data: agents } = agentIds.length
    ? await sb.from("parties").select("id, name").in("id", agentIds)
    : { data: [] as any[] };
  const exactExtra = new Map((extraRates ?? []).filter((e: any) => e.vehicle_id).map((e: any) => [`${e.route_id}|${e.vehicle_id}`, Number(e.extra_charge_amount)]));
  // Route-level fallback matching the DB transport_route_extra(): when the exact
  // route+vehicle has no extra row, use the most recent enabled extra on that route
  // (ANY vehicle) — the Hajj-terminal surcharge is stored per route+vehicle, so a
  // package's vehicle often has no row of its own. Rows are ordered newest-first.
  const routeExtra = new Map<string, number>();
  (extraRates ?? []).forEach((e: any) => { if (!routeExtra.has(e.route_id)) routeExtra.set(e.route_id, Number(e.extra_charge_amount)); });

  const bMap = new Map((bookings ?? []).map((b: any) => [b.id, b]));
  const dMap = new Map((drivers ?? []).map((d: any) => [d.id, d]));
  const vMap = new Map((vehicles ?? []).map((v: any) => [v.id, v]));
  const venMap = new Map((vendors ?? []).map((v: any) => [v.id, v.name]));
  const aMap = new Map((agents ?? []).map((a: any) => [a.id, a.name]));

  // Distribute each booking's discount across its trips as WHOLE SAR that sum to the
  // booking net — instead of scaling every trip by the ratio (which yields fractions
  // like 428.57). Largest-remainder rounding: floor each proportional share, then hand
  // the leftover riyals to the trips with the biggest fractions. Extras (Hajj terminal)
  // are added on top per trip and never discounted.
  const baseFareByTrip = new Map<string, number>();
  {
    const groups = new Map<string, any[]>();
    for (const t of (trips ?? []) as any[]) {
      if (!groups.has(t.booking_id)) groups.set(t.booking_id, []);
      groups.get(t.booking_id)!.push(t);
    }
    Array.from(groups.entries()).forEach(([bid, ts2]) => {
      const b = bMap.get(bid);
      const bases: number[] = ts2.map((t: any) => Number(odMap.get(t.id)?.sell_rate) || 0);
      // Apply the booking's discount RATIO to the trips visible today, then round to
      // whole SAR that sum to the discounted total of THESE trips. Using the ratio
      // (not the booking net) keeps each leg's own fare — critical for packages whose
      // legs span several days, so a lone visible leg isn't handed the whole booking.
      const ratio = b && Number(b.sell_amount) > 0
        ? (Number(b.net_amount) + Number(b.surcharge_amount ?? 0)) / Number(b.sell_amount)
        : 1;
      const target = ratio * bases.reduce((a, n) => a + n, 0);
      const wholes = distributeWhole(bases, target);
      ts2.forEach((t: any, i: number) => baseFareByTrip.set(t.id, wholes[i]));
    });
  }

  const enriched = (trips ?? []).map((t: any) => {
    const b = bMap.get(t.booking_id);
    const veh = t.vehicle_id ? vMap.get(t.vehicle_id) : null;
    const reqVeh = t.requested_vehicle_id ? vMap.get(t.requested_vehicle_id) : null;
    return {
      ...t,
      booking_no: b?.booking_no ?? null,
      passenger_name: b?.passenger_name ?? null,
      mobile: b?.mobile ?? null,
      whatsapp: b?.whatsapp ?? null,
      pax: b?.pax ?? null,
      booking_type: b?.booking_type ?? null,
      agent_id: b?.agent_id ?? null,
      agent_name: b?.agent_id ? aMap.get(b.agent_id) ?? null : "Direct",
      payment_method: b?.payment_method ?? null,
      collect_amount: b?.collect_amount != null ? Number(b.collect_amount) : null,
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
      sell_rate: (() => {
        const raw = odMap.get(t.id)?.sell_rate;
        const veh = t.vehicle_id ?? t.requested_vehicle_id;
        const extra = t.hajj_terminal ? (exactExtra.get(`${t.route_id}|${veh}`) ?? routeExtra.get(t.route_id) ?? 0) : 0;
        // Whole-SAR discounted fare (distributed above so a booking's trips sum to its
        // net), plus the route extra on top.
        return raw == null && extra === 0 ? null : (baseFareByTrip.get(t.id) ?? 0) + Math.round(extra);
      })(),
      vendor_cost: odMap.get(t.id)?.vendor_cost ?? null,
      cash_received: odMap.get(t.id)?.cash_received ?? null,
      assignment_confirmed: odMap.get(t.id)?.assignment_confirmed ?? false,
      tafweej_created: odMap.get(t.id)?.tafweej_created ?? false,
      // Jeddah-airport arrival with an Umrah visa → needs Tafweej.
      needs_tafweej: (t.passenger_visa_type === "umrah") && /^jeddah airport/i.test(t.route_name ?? t.route_label ?? ""),
    };
  });

  // Pending long-reposition approvals for this day's trips (raised by auto-assign).
  const eMap = new Map(enriched.map((t: any) => [t.id, t]));
  const { data: repoRows } = tripIds.length
    ? await sb.from("transport_reposition_requests").select("id, trip_id, driver_id, from_city, to_city, distance_km").eq("status", "pending").in("trip_id", tripIds)
    : { data: [] as any[] };
  const repositions = (repoRows ?? []).map((r: any) => ({
    id: r.id, from_city: r.from_city, to_city: r.to_city, distance_km: r.distance_km,
    driver_name: dMap.get(r.driver_id)?.name ?? "driver",
    route: (eMap.get(r.trip_id) as any)?.route_display ?? "trip",
    trip_time: (eMap.get(r.trip_id) as any)?.trip_time ?? null,
  }));

  // Trips whose driver came from an APPROVED reposition — can be reset if the plan changes.
  const { data: approvedRepo } = tripIds.length
    ? await sb.from("transport_reposition_requests").select("trip_id").eq("status", "approved").in("trip_id", tripIds)
    : { data: [] as any[] };
  const repositionedTripIds = (approvedRepo ?? []).map((r: any) => r.trip_id as string);

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
        repositions={repositions}
        repositionedTripIds={repositionedTripIds}
        canEdit={canEdit}
        canAssign={canAssign}
      />
    </div>
  );
}
