import Link from "next/link";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import PrintButton from "@/components/PrintButton";
import DeleteVoucherButton from "./DeleteVoucherButton";
import VoucherDocument from "@/components/VoucherDocument";
import { VISTA } from "@/lib/voucherBrand";
import { distributeWhole } from "@/lib/transportFare";

export const dynamic = "force-dynamic";

export default async function VoucherPage({ params, searchParams }: { params: { id: string }; searchParams: { brand?: string; fares?: string } }) {
  const sb = createClient();
  const brand = searchParams.brand === "agent" ? "agent" : "vista";
  // Fares are Vista/Admin-only. On the Vista voucher they show by default but
  // can be hidden via ?fares=hide; the agent voucher never shows fares.
  const showFares = brand === "vista" && searchParams.fares !== "hide";

  const [{ data: booking }, { data: trips }] = await Promise.all([
    sb.from("transport_bookings").select("*").eq("id", params.id).maybeSingle(),
    sb.from("transport_trip_sched").select("seq, route_name, route_label, trip_date, trip_time, pickup_location, drop_location, vehicle_id, hajj_terminal, sell_rate, extra_charge, flight_no").eq("booking_id", params.id).order("seq"),
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

  // Encode a link to the PUBLIC voucher (no login needed) so anyone scanning
  // the QR — including the passenger — can open it directly.
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const publicPath = `/v/${b.public_token}`;
  const qr = await QRCode.toDataURL(host ? `${proto}://${host}${publicPath}` : publicPath, { margin: 1, width: 160 });

  const provider = brand === "agent" && agent
    ? { name: agent.agency_name, tagline: null as string | null, contact: agent.contact_person, mobile: agent.mobile, email: agent.email, address: agent.address, logo: agent.logo, note: agent.voucher_note }
    : { ...VISTA, tagline: VISTA.tagline as string | null, note: null as string | null };

  // Per-trip fare = the route+vehicle rate PLUS the customer surcharge (Additional
  // Charges) distributed across the trips as whole SAR — so the surcharge is baked
  // into the fares, not shown as its own line. The booking discount and the Hajj-
  // terminal charge stay as separate lines in the totals below. The Hajj-terminal
  // extra is NOT in the per-trip fare (it's the separate line).
  const vBases: number[] = (trips ?? []).map((t: any) => Number(t.sell_rate) || 0);
  const vGross = vBases.reduce((a, n) => a + n, 0);
  const vSurcharge = Math.max(0, Number(b.surcharge_amount) || 0);
  const vFares = distributeWhole(vBases, vGross + vSurcharge);
  const docTrips = (trips ?? []).map((t: any, i: number) => ({
    seq: t.seq, route: t.route_name ?? t.route_label, trip_date: t.trip_date, trip_time: t.trip_time,
    pickup_location: t.pickup_location, drop_location: t.drop_location,
    vehicle: t.vehicle_id ? vName.get(t.vehicle_id) ?? null : null, hajj_terminal: t.hajj_terminal,
    fare: vFares[i],
  }));

  // Flight details show ONLY for the direction the booking actually has:
  //   • an ARRIVAL airport trip picks up FROM an airport (route starts at an
  //     airport, or the pickup is an airport)  → show Arrival Flight
  //   • a DEPARTURE airport trip drops AT an airport / Hajj terminal (route
  //     ends at an airport, or the drop is an airport)  → show Departure Flight
  // Direction matters: "Jeddah Airport – Makkah" is an arrival, not a departure,
  // even though the word "airport" appears in the route. Each flight is gated on
  // its own trip existing, so the missing direction stays hidden.
  const airportRe = /airport|terminal/i;
  const routeEnds = (route?: string | null) => {
    const parts = (route ?? "").split(/[-–—]/);
    return { from: airportRe.test(parts[0] ?? ""), to: airportRe.test(parts[parts.length - 1] ?? "") };
  };
  const arrTrip = (trips ?? []).find((t: any) => airportRe.test(t.pickup_location ?? "") || routeEnds(t.route_name ?? t.route_label).from);
  // NB: do NOT use hajj_terminal to detect a departure — the Hajj Terminal flag
  // sits on the arrival trip too (arrival INTO the Hajj terminal), which would
  // otherwise mislabel the arrival flight as the departure flight.
  const depTrip = (trips ?? []).find((t: any) => airportRe.test(t.drop_location ?? "") || routeEnds(t.route_name ?? t.route_label).to);
  const arrivalFlight = arrTrip ? (b.arrival_flight || arrTrip.flight_no || null) : null;
  const departureFlight = depTrip ? (b.departure_flight || depTrip.flight_no || null) : null;
  const docBooking = { ...b, arrival_flight: arrivalFlight, departure_flight: departureFlight };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-3 flex items-center gap-2">
        <Link href={`/transport/bookings/${b.id}`} className="btn-outline text-sm">← Back to booking</Link>
        <Link href={`/transport/bookings/${b.id}/voucher?brand=vista`} className={`text-sm ${brand === "vista" ? "font-semibold text-brand" : "text-slate-500 hover:underline"}`}>Vista</Link>
        <Link href={`/transport/bookings/${b.id}/voucher?brand=agent`} className={`text-sm ${brand === "agent" ? "font-semibold text-brand" : "text-slate-500 hover:underline"}`}>Agent</Link>
        {brand === "vista" && (
          <Link href={`/transport/bookings/${b.id}/voucher?brand=vista${showFares ? "&fares=hide" : ""}`}
            className="ml-2 rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
            {showFares ? "Hide fare" : "Show fare"}
          </Link>
        )}
        <span className="ml-auto flex items-center gap-2">
          {b.status === "cancelled" && <DeleteVoucherButton bookingId={b.id} bookingNo={b.booking_no ?? b.id} />}
          <PrintButton />
        </span>
      </div>

      <VoucherDocument provider={provider} booking={docBooking} trips={docTrips} qr={qr} showFares={showFares} />
    </div>
  );
}
