import Link from "next/link";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import PrintButton from "@/components/PrintButton";
import DeleteVoucherButton from "./DeleteVoucherButton";

export const dynamic = "force-dynamic";

const INSTRUCTIONS = [
  "Please be ready at the pickup point 15 minutes before the scheduled time.",
  "Keep your passport and this voucher available during the trip.",
  "Contact the number on this voucher for any assistance or delays.",
  "Luggage allowance is subject to the vehicle capacity booked.",
];

// Vista company details shown on the Vista-branded voucher. Edit these values
// to match your official details (name, phone/WhatsApp, email, address).
const VISTA = {
  name: "Vista Group",
  tagline: "Umrah & Ziyarah Transport Services",
  contact: "Vista Operations",
  mobile: "+966 53 004 8282",
  email: "sales@vista-group.co",
  address: "Khalidiya, Madinah",
  logo: "/logo.svg",
};

export default async function VoucherPage({ params, searchParams }: { params: { id: string }; searchParams: { brand?: string } }) {
  const sb = createClient();
  const brand = searchParams.brand === "agent" ? "agent" : "vista";

  const [{ data: booking }, { data: trips }] = await Promise.all([
    sb.from("transport_bookings").select("*").eq("id", params.id).maybeSingle(),
    sb.from("transport_trip_sched").select("seq, route_name, route_label, trip_date, trip_time, pickup_location, drop_location, vehicle_id, hajj_terminal").eq("booking_id", params.id).order("seq"),
  ]);
  if (!booking) return <div className="card text-slate-500">Booking not found. <Link href="/transport/bookings" className="text-brand hover:underline">Back</Link></div>;
  const b = booking as any;

  const vehicleIds = Array.from(new Set((trips ?? []).map((t: any) => t.vehicle_id).filter(Boolean)));
  const { data: vehicles } = vehicleIds.length ? await sb.from("transport_vehicles").select("id, name").in("id", vehicleIds) : { data: [] as any[] };
  const vName = new Map((vehicles ?? []).map((v: any) => [v.id, v.name]));

  // agent_id references the Customer/Agent master (parties). For agent-branded
  // vouchers, use the party's name and, when the agent also has a B2B portal
  // login, its branding (logo, voucher note, contact) via agent_party_id.
  let agent: any = null;
  if (brand === "agent" && b.agent_id) {
    const { data: party } = await sb.from("parties").select("name, phone").eq("id", b.agent_id).maybeSingle();
    const { data: login } = await sb.from("b2b_agents").select("agency_name, contact_person, email, mobile, address, logo, voucher_note").eq("agent_party_id", b.agent_id).maybeSingle();
    if (party || login) {
      agent = {
        agency_name: party?.name ?? login?.agency_name,
        contact_person: login?.contact_person ?? null,
        email: login?.email ?? null,
        mobile: login?.mobile ?? party?.phone ?? null,
        address: login?.address ?? null,
        logo: login?.logo ?? null,
        voucher_note: login?.voucher_note ?? null,
      };
    }
  }

  const qr = await QRCode.toDataURL(`VISTA-TRP:${b.booking_no ?? b.id}`, { margin: 1, width: 160 });

  const provider = brand === "agent" && agent
    ? { name: agent.agency_name, tagline: null as string | null, contact: agent.contact_person, mobile: agent.mobile, email: agent.email, address: agent.address, logo: agent.logo, note: agent.voucher_note }
    : { ...VISTA, tagline: VISTA.tagline as string | null, note: null as string | null };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-3 flex items-center gap-2">
        <Link href={`/transport/bookings/${b.id}`} className="btn-outline text-sm">← Back to booking</Link>
        <Link href={`/transport/bookings/${b.id}/voucher?brand=vista`} className={`text-sm ${brand === "vista" ? "font-semibold text-brand" : "text-slate-500 hover:underline"}`}>Vista</Link>
        <Link href={`/transport/bookings/${b.id}/voucher?brand=agent`} className={`text-sm ${brand === "agent" ? "font-semibold text-brand" : "text-slate-500 hover:underline"}`}>Agent</Link>
        <span className="ml-auto flex items-center gap-2">
          {b.status === "cancelled" && <DeleteVoucherButton bookingId={b.id} bookingNo={b.booking_no ?? b.id} />}
          <PrintButton />
        </span>
      </div>

      <div className="print-doc overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {/* Branded header band */}
        <div className="relative flex items-start justify-between gap-4 bg-brand px-8 py-6 text-white" style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" } as any}>
          <div className="flex items-center gap-4">
            {provider.logo ? <img src={provider.logo} alt={provider.name} className="h-16 w-auto rounded-lg bg-white/95 object-contain p-1.5" /> : null}
            <div>
              <div className="text-2xl font-extrabold leading-tight tracking-tight">{provider.name}</div>
              {provider.tagline && <div className="text-sm text-white/80">{provider.tagline}</div>}
              <div className="mt-1 text-xs text-white/80">{[provider.mobile, provider.email].filter(Boolean).join("  ·  ")}</div>
              {provider.address && <div className="text-xs text-white/70">{provider.address}</div>}
            </div>
          </div>
          <div className="flex flex-col items-end">
            <div className="rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest">Transport Voucher</div>
            <div className="mt-1 text-xl font-bold">{b.booking_no ?? "—"}</div>
            <img src={qr} alt="QR" className="mt-2 h-24 w-24 rounded-lg bg-white p-1" style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" } as any} />
          </div>
        </div>

        <div className="p-8">
        {/* Passenger */}
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand">Passenger Details</div>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 text-sm sm:grid-cols-3">
          {[
            ["Passenger", b.passenger_name || "—"],
            ["Mobile", b.mobile || "—"],
            ["Passengers", b.pax ?? "—"],
            ["Nationality", b.nationality || "—"],
            ["Arrival", [b.arrival_flight, b.arrival_date, b.arrival_time?.slice(0,5)].filter(Boolean).join(" · ") || "—"],
            ["Departure", [b.departure_flight, b.departure_date, b.departure_time?.slice(0,5)].filter(Boolean).join(" · ") || "—"],
          ].map(([label, val], i) => (
            <div key={i} className="bg-white px-3 py-2.5">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
              <div className="font-semibold text-slate-800">{val as any}</div>
            </div>
          ))}
        </div>

        {/* Trips */}
        <div className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wide text-brand">Itinerary</div>
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">#</th><th className="px-3 py-2">Route</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Time</th><th className="px-3 py-2">Pickup</th><th className="px-3 py-2">Drop</th><th className="px-3 py-2">Vehicle</th>
            </tr></thead>
            <tbody>
              {(trips ?? []).map((t: any, i: number) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-500">{t.seq ?? i + 1}</td>
                  <td className="px-3 py-2 font-semibold text-slate-800">{t.route_name ?? t.route_label ?? "—"}{t.hajj_terminal && <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">Hajj Terminal</span>}</td>
                  <td className="px-3 py-2">{t.trip_date ?? "—"}</td>
                  <td className="px-3 py-2">{t.trip_time?.slice(0, 5) ?? "—"}</td>
                  <td className="px-3 py-2">{t.pickup_location ?? "—"}</td>
                  <td className="px-3 py-2">{t.drop_location ?? "—"}</td>
                  <td className="px-3 py-2">{t.vehicle_id ? vName.get(t.vehicle_id) ?? "—" : "—"}</td>
                </tr>
              ))}
              {(trips ?? []).length === 0 && <tr><td colSpan={7} className="px-3 py-3 text-slate-400">No trips.</td></tr>}
            </tbody>
          </table>
        </div>

        {/* Footer: emergency + instructions */}
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border-l-4 border-brand bg-brand/5 p-4 text-sm" style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" } as any}>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-brand">24/7 Assistance</div>
            <div className="mt-1 text-lg font-bold text-slate-800">{provider.mobile}</div>
            <div className="text-xs text-slate-500">{provider.contact}</div>
          </div>
          <div className="sm:col-span-2 text-xs leading-relaxed text-slate-600">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Important Instructions</div>
            <ul className="list-disc space-y-0.5 pl-4">
              {INSTRUCTIONS.map((x, i) => <li key={i}>{x}</li>)}
              {provider.note && <li>{provider.note}</li>}
            </ul>
          </div>
        </div>
        {b.remarks && <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600"><b>Remarks:</b> {b.remarks}</div>}

        <div className="mt-6 border-t border-slate-200 pt-3 text-center text-[11px] text-slate-400">
          Thank you for travelling with {provider.name}. This voucher was generated electronically and is valid without a signature.
        </div>
        </div>
      </div>
    </div>
  );
}
