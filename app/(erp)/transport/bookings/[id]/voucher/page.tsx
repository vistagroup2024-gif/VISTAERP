import Link from "next/link";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import PrintButton from "@/components/PrintButton";

export const dynamic = "force-dynamic";

const INSTRUCTIONS = [
  "Please be ready at the pickup point 15 minutes before the scheduled time.",
  "Keep your passport and this voucher available during the trip.",
  "Contact the number on this voucher for any assistance or delays.",
  "Luggage allowance is subject to the vehicle capacity booked.",
];

export default async function VoucherPage({ params, searchParams }: { params: { id: string }; searchParams: { brand?: string } }) {
  const sb = createClient();
  const brand = searchParams.brand === "agent" ? "agent" : "vista";

  const [{ data: booking }, { data: trips }] = await Promise.all([
    sb.from("transport_bookings").select("*").eq("id", params.id).maybeSingle(),
    sb.from("transport_trip_sched").select("seq, route_name, route_label, trip_date, trip_time, pickup_location, drop_location, vehicle_id").eq("booking_id", params.id).order("seq"),
  ]);
  if (!booking) return <div className="card text-slate-500">Booking not found. <Link href="/transport/bookings" className="text-brand hover:underline">Back</Link></div>;
  const b = booking as any;

  const vehicleIds = Array.from(new Set((trips ?? []).map((t: any) => t.vehicle_id).filter(Boolean)));
  const { data: vehicles } = vehicleIds.length ? await sb.from("transport_vehicles").select("id, name").in("id", vehicleIds) : { data: [] as any[] };
  const vName = new Map((vehicles ?? []).map((v: any) => [v.id, v.name]));

  let agent: any = null;
  if (brand === "agent" && b.agent_id) {
    const { data } = await sb.from("b2b_agents").select("agency_name, contact_person, email, mobile, address, logo, voucher_note").eq("id", b.agent_id).maybeSingle();
    agent = data;
  }

  const qr = await QRCode.toDataURL(`VISTA-TRP:${b.booking_no ?? b.id}`, { margin: 1, width: 160 });

  const provider = brand === "agent" && agent
    ? { name: agent.agency_name, contact: agent.contact_person, mobile: agent.mobile, email: agent.email, address: agent.address, logo: agent.logo, note: agent.voucher_note }
    : { name: "VISTA GROUP", contact: "Vista Operations", mobile: "+966 12 000 0000", email: "ops@vista-group.co", address: "Makkah · Madinah · Jeddah, Saudi Arabia", logo: "/logo.svg", note: null };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-3 flex items-center gap-2">
        <Link href={`/transport/bookings/${b.id}`} className="btn-outline text-sm">← Back to booking</Link>
        <Link href={`/transport/bookings/${b.id}/voucher?brand=vista`} className={`text-sm ${brand === "vista" ? "font-semibold text-brand" : "text-slate-500 hover:underline"}`}>Vista</Link>
        <Link href={`/transport/bookings/${b.id}/voucher?brand=agent`} className={`text-sm ${brand === "agent" ? "font-semibold text-brand" : "text-slate-500 hover:underline"}`}>Agent</Link>
        <span className="ml-auto"><PrintButton /></span>
      </div>

      <div className="print-doc rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-200 pb-5">
          <div className="flex items-center gap-3">
            {provider.logo ? <img src={provider.logo} alt={provider.name} className="h-14 w-auto object-contain" /> : null}
            <div>
              <div className="text-xl font-bold text-slate-800">{provider.name}</div>
              <div className="text-xs text-slate-500">{provider.address}</div>
              <div className="text-xs text-slate-500">{[provider.mobile, provider.email].filter(Boolean).join(" · ")}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-slate-400">Transport Voucher</div>
            <div className="text-lg font-bold text-slate-800">{b.booking_no ?? "—"}</div>
            <img src={qr} alt="QR" className="ml-auto mt-1 h-24 w-24" />
          </div>
        </div>

        {/* Passenger */}
        <div className="grid grid-cols-2 gap-4 py-5 text-sm sm:grid-cols-4">
          <div><div className="text-xs text-slate-400">Passenger</div><div className="font-medium text-slate-800">{b.passenger_name ?? "—"}</div></div>
          <div><div className="text-xs text-slate-400">Mobile</div><div className="font-medium text-slate-800">{b.mobile ?? "—"}</div></div>
          <div><div className="text-xs text-slate-400">Passengers</div><div className="font-medium text-slate-800">{b.pax ?? "—"}</div></div>
          <div><div className="text-xs text-slate-400">Nationality</div><div className="font-medium text-slate-800">{b.nationality ?? "—"}</div></div>
          <div><div className="text-xs text-slate-400">Arrival</div><div className="font-medium text-slate-800">{[b.arrival_flight, b.arrival_date, b.arrival_time?.slice(0,5)].filter(Boolean).join(" · ") || "—"}</div></div>
          <div><div className="text-xs text-slate-400">Departure</div><div className="font-medium text-slate-800">{[b.departure_flight, b.departure_date, b.departure_time?.slice(0,5)].filter(Boolean).join(" · ") || "—"}</div></div>
        </div>

        {/* Trips */}
        <div className="py-2">
          <div className="mb-2 text-sm font-semibold text-slate-700">Trips</div>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-200 text-xs text-slate-400">
              <th className="py-1 text-left">#</th><th className="py-1 text-left">Route</th><th className="py-1 text-left">Date</th><th className="py-1 text-left">Time</th><th className="py-1 text-left">Pickup</th><th className="py-1 text-left">Drop</th><th className="py-1 text-left">Vehicle</th>
            </tr></thead>
            <tbody>
              {(trips ?? []).map((t: any, i: number) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-1.5">{t.seq ?? i + 1}</td>
                  <td className="py-1.5 font-medium text-slate-800">{t.route_name ?? t.route_label ?? "—"}</td>
                  <td className="py-1.5">{t.trip_date ?? "—"}</td>
                  <td className="py-1.5">{t.trip_time?.slice(0, 5) ?? "—"}</td>
                  <td className="py-1.5">{t.pickup_location ?? "—"}</td>
                  <td className="py-1.5">{t.drop_location ?? "—"}</td>
                  <td className="py-1.5">{t.vehicle_id ? vName.get(t.vehicle_id) ?? "—" : "—"}</td>
                </tr>
              ))}
              {(trips ?? []).length === 0 && <tr><td colSpan={7} className="py-2 text-slate-400">No trips.</td></tr>}
            </tbody>
          </table>
        </div>

        {/* Footer: emergency + instructions */}
        <div className="mt-4 grid grid-cols-1 gap-4 border-t border-slate-200 pt-4 sm:grid-cols-3">
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <div className="text-xs font-semibold uppercase text-slate-400">Emergency Contact</div>
            <div className="mt-1 font-bold text-slate-800">{provider.mobile}</div>
            <div className="text-xs text-slate-500">{provider.contact}</div>
          </div>
          <div className="sm:col-span-2 text-xs text-slate-600">
            <div className="mb-1 text-xs font-semibold uppercase text-slate-400">Instructions</div>
            <ul className="list-disc space-y-0.5 pl-4">
              {INSTRUCTIONS.map((x, i) => <li key={i}>{x}</li>)}
              {provider.note && <li>{provider.note}</li>}
            </ul>
          </div>
        </div>
        {b.remarks && <div className="mt-3 text-xs text-slate-500"><b>Remarks:</b> {b.remarks}</div>}
      </div>
    </div>
  );
}
