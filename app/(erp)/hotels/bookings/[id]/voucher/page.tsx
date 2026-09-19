import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { guardStaffPage } from "@/lib/staffSession";
import PrintButton from "@/components/PrintButton";
import HotelVoucherDocument from "@/components/HotelVoucherDocument";
import { VISTA, VISTA_BANK } from "@/lib/voucherBrand";
import { roomSummary } from "../../../lib";
import QRCode from "qrcode";

export const dynamic = "force-dynamic";

export default async function HotelVoucherPage({ params, searchParams }: { params: { id: string }; searchParams: { type?: string } }) {
  await guardStaffPage("hotels.voucher");
  const docType = searchParams?.type === "invoice" ? "invoice" : "voucher";
  const supabase = createClient();
  const { data: b } = await supabase
    .from("hotel_bookings")
    .select("*, parties:agent_id(name), hotels:hotel_id(name)")
    .eq("id", params.id).single();
  if (!b) notFound();

  const [{ data: stayRows }, { data: roomRows }] = await Promise.all([
    supabase.from("hotel_purchase_bookings")
      .select("id, hotel_name, city, check_in, check_out, nights, room_type, rooms, meal_plan, hcn, sale_rate, sale_total, currency, hotels:hotel_id(name)")
      .eq("booking_id", params.id).order("sort").order("created_at"),
    supabase.from("hotel_stay_rooms").select("stay_id, room_type").eq("booking_id", params.id).order("sort"),
  ]);
  // Per-room-type summary per stay (e.g. "2 Quad · 1 Triple (TPL)"), from the real rooms.
  const roomsByStay = new Map<string, any[]>();
  for (const r of (roomRows ?? []) as any[]) { const a = roomsByStay.get(r.stay_id) ?? []; a.push(r); roomsByStay.set(r.stay_id, a); }
  const stays = (stayRows ?? []).map((s: any) => {
    const rd = roomsByStay.get(s.id) ?? [];
    return {
      hotel_name: s.hotels?.name ?? s.hotel_name, city: s.city, check_in: s.check_in, check_out: s.check_out,
      nights: s.nights, room_type: s.room_type, room_summary: rd.length ? roomSummary(rd) : null,
      rooms: s.rooms, meal_plan: s.meal_plan, hcn: s.hcn,
      sale_rate: s.sale_rate, sale_total: s.sale_total, currency: s.currency,
    };
  });
  const hcn = stays[0]?.hcn ?? null;
  const bookingRoomSummary = (roomRows ?? []).length ? roomSummary(roomRows as any[]) : null;

  const origin = process.env.NEXT_PUBLIC_SITE_URL || "";
  const qr = b.public_token ? await QRCode.toDataURL(`${origin}/hv/${b.public_token}`, { margin: 1, width: 200 }) : undefined;

  return (
    <div>
      <div className="no-print mb-4 flex items-center justify-between">
        <div className="flex gap-2 rounded-lg bg-slate-100 p-1 text-sm font-medium">
          <Link href={`/hotels/bookings/${params.id}/voucher?type=voucher`} className={`rounded-md px-3 py-1.5 ${docType === "voucher" ? "bg-white text-brand shadow-sm" : "text-slate-500"}`}>Voucher</Link>
          <Link href={`/hotels/bookings/${params.id}/voucher?type=invoice`} className={`rounded-md px-3 py-1.5 ${docType === "invoice" ? "bg-white text-brand shadow-sm" : "text-slate-500"}`}>Invoice</Link>
        </div>
        <PrintButton />
      </div>
      <HotelVoucherDocument
        provider={{ name: VISTA.name, tagline: VISTA.tagline, mobile: VISTA.mobile, email: VISTA.email, address: VISTA.address, logo: VISTA.logo, logoLockup: VISTA.logoLockup }}
        booking={{
          booking_no: b.booking_no, booking_date: b.booking_date, guest_name: b.guest_name, group_no: b.group_no, agent: (b as any).parties?.name ?? null,
          hotel_name: (b as any).hotels?.name ?? b.hotel_name, city: b.city, check_in: b.check_in, check_out: b.check_out,
          nights: b.nights, room_type: b.room_type, room_summary: bookingRoomSummary, rooms: b.rooms, guests: b.guests, meal_plan: b.meal_plan, hcn,
          stays,
        }}
        qr={qr}
        docType={docType}
        bank={docType === "invoice" ? VISTA_BANK : undefined}
      />
    </div>
  );
}
