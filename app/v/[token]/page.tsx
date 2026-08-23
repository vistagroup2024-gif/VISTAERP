import QRCode from "qrcode";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import VoucherDocument from "@/components/VoucherDocument";
import SetDocTitle from "@/components/SetDocTitle";
import { voucherFileName } from "@/lib/voucherFileName";
import { VISTA } from "@/lib/voucherBrand";

export const dynamic = "force-dynamic";

// Public, login-free transport voucher opened by scanning the QR. Reads only
// the safe fields exposed by the public_transport_voucher RPC (SECURITY DEFINER,
// keyed on the booking's random public_token).
export default async function PublicVoucherPage({ params, searchParams }: { params: { token: string }; searchParams: { brand?: string } }) {
  const sb = createClient();
  const { data } = await sb.rpc("public_transport_voucher", { p_token: params.token });
  const brand = searchParams.brand === "agent" ? "agent" : "vista";

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6 text-center">
        <div>
          <div className="text-2xl font-bold text-slate-800">{VISTA.name}</div>
          <p className="mt-2 text-slate-500">This voucher link is invalid or has expired.</p>
        </div>
      </div>
    );
  }

  const d = data as any;
  const booking = d.booking ?? {};
  const trips = (d.trips ?? []) as any[];
  const ag = d.agent ?? null;
  // Agent-branded when opened from the agent voucher's QR (?brand=agent) and the
  // booking has an agent with branding; otherwise Vista.
  const useAgent = brand === "agent" && ag && ag.agency_name;
  const provider = useAgent
    ? { name: ag.agency_name, tagline: null as string | null, contact: ag.contact_person, mobile: ag.mobile, email: ag.email, address: ag.address, logo: ag.logo, logoHasName: !!ag.logo_lockup, note: ag.voucher_note }
    : { ...VISTA, tagline: VISTA.tagline as string | null, note: null as string | null };
  const helpline = useAgent ? "+966 53 0048282" : null;

  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const suffix = useAgent ? "?brand=agent" : "";
  const qr = await QRCode.toDataURL(host ? `${proto}://${host}/v/${params.token}${suffix}` : `/v/${params.token}${suffix}`, { margin: 1, width: 160 });

  return (
    <div className="min-h-screen bg-slate-100 px-3 py-6">
      <div className="mx-auto max-w-3xl">
        <SetDocTitle title={voucherFileName(booking.booking_no, booking.passenger_name)} />
        <VoucherDocument provider={provider} booking={booking} trips={trips} qr={qr} showFares={false} helpline={helpline} />
      </div>
    </div>
  );
}
