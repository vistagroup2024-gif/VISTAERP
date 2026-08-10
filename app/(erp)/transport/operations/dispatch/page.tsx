import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PrintButton from "@/components/PrintButton";
import { fmtTime12 } from "@/lib/format";

export const dynamic = "force-dynamic";

function mapLink(q: string | null) {
  if (!q) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

export default async function DispatchPage({ searchParams }: { searchParams: { date?: string; driver?: string } }) {
  const sb = createClient();
  const today = new Date().toISOString().slice(0, 10);
  const date = searchParams.date || today;

  let tq = sb.from("transport_trip_sched")
    .select("id, booking_id, seq, route_name, route_label, trip_time, pickup_location, drop_location, vehicle_id, driver_id, remarks, status")
    .eq("trip_date", date).not("driver_id", "is", null).order("trip_time");
  if (searchParams.driver) tq = tq.eq("driver_id", searchParams.driver);
  const { data: trips } = await tq;

  const bIds = Array.from(new Set((trips ?? []).map((t: any) => t.booking_id)));
  const [{ data: bookings }, { data: drivers }, { data: vehicles }] = await Promise.all([
    bIds.length ? sb.from("transport_bookings").select("id, booking_no, passenger_name, mobile, pax, arrival_flight, arrival_time, departure_flight, departure_time").in("id", bIds) : Promise.resolve({ data: [] as any[] }),
    sb.from("transport_drivers").select("id, name, mobile, vehicle_id").order("name"),
    sb.from("transport_vehicles").select("id, name"),
  ]);
  const bMap = new Map((bookings ?? []).map((b: any) => [b.id, b]));
  const dMap = new Map((drivers ?? []).map((d: any) => [d.id, d]));
  const vMap = new Map((vehicles ?? []).map((v: any) => [v.id, v.name]));

  const byDriver = new Map<string, any[]>();
  (trips ?? []).forEach((t: any) => {
    const arr = byDriver.get(t.driver_id) ?? [];
    arr.push(t); byDriver.set(t.driver_id, arr);
  });

  return (
    <div className="mx-auto max-w-4xl">
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <Link href={`/transport/operations?date=${date}`} className="btn-outline text-sm">← Operations</Link>
        <span className="text-sm text-slate-500">Driver sheets · {date === today ? "Today" : date}</span>
        <span className="ml-auto"><PrintButton label="🖨 Print all sheets" /></span>
      </div>

      {byDriver.size === 0 ? (
        <div className="card text-slate-400">No assigned trips for this day. Assign drivers in Operations first.</div>
      ) : (
        <div className="space-y-6">
          {Array.from(byDriver.entries()).map(([driverId, list]) => {
            const d = dMap.get(driverId);
            return (
              <div key={driverId} className="print-doc rounded-xl border border-slate-200 bg-white p-6 shadow-sm" style={{ breakInside: "avoid" }}>
                <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                  <div>
                    <div className="text-lg font-bold text-slate-800">🧑‍✈️ {d?.name ?? "Driver"}</div>
                    <div className="text-xs text-slate-500">{d?.mobile ?? ""}{d?.vehicle_id ? ` · ${vMap.get(d.vehicle_id) ?? ""}` : ""}</div>
                  </div>
                  <div className="text-right text-sm text-slate-500">{date}<div className="text-xs">{list.length} trip(s)</div></div>
                </div>

                <div className="mt-3 space-y-3">
                  {list.map((t: any) => {
                    const b = bMap.get(t.booking_id);
                    return (
                      <div key={t.id} className="rounded-lg border border-slate-100 p-3 text-sm" style={{ breakInside: "avoid" }}>
                        <div className="flex flex-wrap items-baseline gap-x-3">
                          <span className="text-base font-bold text-slate-800">{fmtTime12(t.trip_time) || "—"}</span>
                          <span className="font-medium text-slate-700">{t.route_name ?? t.route_label ?? "—"}</span>
                          <span className="text-xs text-slate-400">{b?.booking_no}</span>
                          <span className="ml-auto text-xs text-slate-500">{t.vehicle_id ? vMap.get(t.vehicle_id) : ""}</span>
                        </div>
                        <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                          <div><span className="text-xs text-slate-400">Passenger</span><div>{b?.passenger_name ?? "—"} ({b?.pax ?? "—"})</div></div>
                          <div><span className="text-xs text-slate-400">Contact</span><div>{b?.mobile ?? "—"}</div></div>
                          <div><span className="text-xs text-slate-400">Arrival</span><div>{[b?.arrival_flight, b?.arrival_time?.slice(0,5)].filter(Boolean).join(" ") || "—"}</div></div>
                          <div><span className="text-xs text-slate-400">Departure</span><div>{[b?.departure_flight, b?.departure_time?.slice(0,5)].filter(Boolean).join(" ") || "—"}</div></div>
                          <div className="sm:col-span-2"><span className="text-xs text-slate-400">Pickup</span><div>{t.pickup_location ?? "—"} {mapLink(t.pickup_location) && <a href={mapLink(t.pickup_location)!} className="text-brand hover:underline no-print" target="_blank">map</a>}</div></div>
                          <div className="sm:col-span-2"><span className="text-xs text-slate-400">Drop</span><div>{t.drop_location ?? "—"} {mapLink(t.drop_location) && <a href={mapLink(t.drop_location)!} className="text-brand hover:underline no-print" target="_blank">map</a>}</div></div>
                          {t.remarks && <div className="sm:col-span-4"><span className="text-xs text-slate-400">Remarks</span><div>{t.remarks}</div></div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 flex justify-between text-xs text-slate-400">
                  <span>Driver signature: ____________________</span>
                  <span>Vista Group Transport</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
