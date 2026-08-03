import Link from "next/link";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import PrintButton from "@/components/PrintButton";
import DeleteVoucherButton from "./DeleteVoucherButton";
import VoucherDocument from "@/components/VoucherDocument";
import { VISTA } from "@/lib/voucherBrand";

export const dynamic = "force-dynamic";

export default async function VoucherPage({ params, searchParams }: { params: { id: string }; searchParams: { brand?: string } }) {
  const sb = createClient();
  const brand = searchParams.brand === "agent" ? "agent" : "vista";

  const [{ data: booking }, { data: trips }] = await Promise.all([
    sb.from("transport_bookings").select("*").eq("id", params.id).maybeSingle(),
    sb.from("transport_trip_sched").select("seq, route_name, route_label, trip_date, trip_time, pickup_location, drop_location, vehicle_id, hajj_terminal, sell_rate, extra_charge").eq("booking_id", params.id).order("seq"),
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

  const docTrips = (trips ?? []).map((t: any) => ({
    seq: t.seq, route: t.route_name ?? t.route_label, trip_date: t.trip_date, trip_time: t.trip_time,
    pickup_location: t.pickup_location, drop_location: t.drop_location,
    vehicle: t.vehicle_id ? vName.get(t.vehicle_id) ?? null : null, hajj_terminal: t.hajj_terminal,
    fare: (Number(t.sell_rate) || 0) + (Number(t.extra_charge) || 0),
  }));

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

      {/* Fares/total are Vista/Admin only — hidden on the agent-branded voucher. */}
      <VoucherDocument provider={provider} booking={b} trips={docTrips} qr={qr} showFares={brand === "vista"} />
    </div>
  );
}
