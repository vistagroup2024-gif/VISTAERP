import Link from "next/link";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { redirect } from "next/navigation";
import { getAgent, can } from "@/lib/agentSession";
import { createClient } from "@/lib/supabase/server";
import PrintButton from "@/components/PrintButton";
import VoucherDocument from "@/components/VoucherDocument";
import { VISTA } from "@/lib/voucherBrand";
import { distributeWhole } from "@/lib/transportFare";
import SetDocTitle from "@/components/SetDocTitle";
import { voucherFileName } from "@/lib/voucherFileName";
import AgentInvoiceVoucher from "./AgentInvoiceVoucher";

export const dynamic = "force-dynamic";

// Agent-portal voucher (Vista or agent branded). Reads only the agent's own booking
// via the token-scoped RPC, so an agent can never open another agency's voucher.
export default async function AgentVoucherPage({ params, searchParams }: { params: { id: string }; searchParams: { brand?: string; fares?: string } }) {
  const agent = await getAgent();
  if (!agent) redirect("/login");
  if (!can(agent, "transport.view") && !can(agent, "transport.request")) {
    return <div className="rounded-xl bg-white p-6 text-slate-500 shadow-sm">You don’t have access to Transport.</div>;
  }
  // "invoice" mode: agent-branded voucher where the agent enters their own selling fares.
  const invoice = searchParams.fares === "mine";
  const brand = invoice ? "agent" : (searchParams.brand === "agent" ? "agent" : "vista");
  const sb = createClient();
  const [{ data: bundle }, { data: masters }, { data: branding }] = await Promise.all([
    sb.rpc("b2b_transport_get_booking", { p_token: agent.token, p_id: params.id }),
    sb.rpc("b2b_transport_masters", { p_token: agent.token }),
    brand === "agent" ? sb.rpc("b2b_agent_branding", { p_token: agent.token }) : Promise.resolve({ data: null }),
  ]);
  if (!bundle) return <div className="rounded-xl bg-white p-6 text-slate-500 shadow-sm">Booking not found.</div>;
  const b: any = (bundle as any).booking;
  const trips: any[] = (bundle as any).trips ?? [];
  const m: any = masters ?? {};
  const vName = new Map<string, string>((m.vehicles ?? []).map((v: any) => [v.id as string, v.name as string]));
  const rName = new Map<string, string>((m.routes ?? []).map((r: any) => [r.id as string, r.name as string]));

  // Vista voucher shows the agent's fares; the agent-branded voucher never shows fares.
  const showFares = brand === "vista";

  // Per-trip fare = rate + surcharge − discount, distributed to whole SAR (discounted).
  const vBases: number[] = trips.map((t: any) => Number(t.sell_rate) || 0);
  const vGross = vBases.reduce((a, n) => a + n, 0);
  const vSurcharge = Math.max(0, Number(b.surcharge_amount) || 0);
  const vDiscount = Math.max(0, Number(b.discount) || 0);
  const vFares = distributeWhole(vBases, Math.max(0, vGross + vSurcharge - vDiscount));
  const docTrips = trips.map((t: any, i: number) => ({
    seq: t.seq, route: t.route_id ? rName.get(t.route_id) ?? t.route_label : t.route_label,
    trip_date: t.trip_date, trip_time: t.trip_time, pickup_location: t.pickup_location, drop_location: t.drop_location,
    vehicle: (t.requested_vehicle_id ?? t.vehicle_id) ? vName.get(t.requested_vehicle_id ?? t.vehicle_id) ?? null : null, hajj_terminal: t.hajj_terminal, fare: vFares[i],
  }));

  const airportRe = /airport|terminal/i;
  const routeEnds = (route?: string | null) => { const p = (route ?? "").split(/[-–—]/); return { from: airportRe.test(p[0] ?? ""), to: airportRe.test(p[p.length - 1] ?? "") }; };
  const arrTrip = docTrips.find((t: any) => airportRe.test(t.pickup_location ?? "") || routeEnds(t.route).from);
  const depTrip = docTrips.find((t: any) => airportRe.test(t.drop_location ?? "") || routeEnds(t.route).to);
  const docBooking = { ...b, discount: 0, sell_amount: null,
    arrival_flight: arrTrip ? (b.arrival_flight || trips[docTrips.indexOf(arrTrip)]?.flight_no || null) : null,
    departure_flight: depTrip ? (b.departure_flight || trips[docTrips.indexOf(depTrip)]?.flight_no || null) : null };

  const br: any = branding ?? null;
  const provider = brand === "agent" && br
    ? { name: br.agency_name, tagline: null as string | null, contact: br.contact_person, mobile: br.mobile ?? agent.mobile, email: br.email ?? agent.email, address: br.address, logo: br.logo, note: br.voucher_note }
    : { ...VISTA, tagline: VISTA.tagline as string | null, note: null as string | null };

  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  // Scanning the agent voucher's QR opens the AGENT-branded public voucher; the Vista
  // voucher opens the Vista-branded one.
  const publicPath = b.public_token ? `/v/${b.public_token}${brand === "agent" ? "?brand=agent" : ""}` : " ";
  const qr = await QRCode.toDataURL(host && b.public_token ? `${proto}://${host}${publicPath}` : publicPath, { margin: 1, width: 160 });
  const helpline = brand === "agent" ? "+966 53 0048282" : null;

  const docTitle = <SetDocTitle title={voucherFileName(b.booking_no, b.passenger_name)} />;
  const tabs = (
    <div className="no-print mb-3 flex flex-wrap items-center gap-3">
      <Link href={`/agent/module/transport/${b.id}`} className="btn-outline text-sm">← Back</Link>
      <Link href={`/agent/module/transport/${b.id}/voucher?brand=vista`} className={`text-sm ${!invoice && brand === "vista" ? "font-semibold text-brand" : "text-slate-500 hover:underline"}`}>Vista</Link>
      <Link href={`/agent/module/transport/${b.id}/voucher?brand=agent`} className={`text-sm ${!invoice && brand === "agent" ? "font-semibold text-brand" : "text-slate-500 hover:underline"}`}>Agent</Link>
      <Link href={`/agent/module/transport/${b.id}/voucher?fares=mine`} className={`text-sm ${invoice ? "font-semibold text-brand" : "text-slate-500 hover:underline"}`}>Agent + My Fare</Link>
      {!invoice && <span className="ml-auto"><PrintButton /></span>}
    </div>
  );

  if (invoice) {
    const tripsBase = trips.map((t: any) => ({
      id: t.id, seq: t.seq, route: t.route_id ? rName.get(t.route_id) ?? t.route_label : t.route_label,
      trip_date: t.trip_date, trip_time: t.trip_time, pickup_location: t.pickup_location, drop_location: t.drop_location,
      vehicle: (t.requested_vehicle_id ?? t.vehicle_id) ? vName.get(t.requested_vehicle_id ?? t.vehicle_id) ?? null : null,
      hajj_terminal: t.hajj_terminal, fare: t.agent_sell_rate != null ? Number(t.agent_sell_rate) : null,
    }));
    return (
      <div className="mx-auto max-w-3xl">
        {docTitle}
        {tabs}
        <AgentInvoiceVoucher token={agent.token} bookingId={b.id} provider={provider} booking={docBooking}
          tripsBase={tripsBase} qr={qr} helpline={helpline} currency={b.currency ?? agent.currency ?? "SAR"} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      {docTitle}
      {tabs}
      <VoucherDocument provider={provider} booking={docBooking} trips={docTrips} qr={qr} showFares={showFares} helpline={helpline} />
    </div>
  );
}
