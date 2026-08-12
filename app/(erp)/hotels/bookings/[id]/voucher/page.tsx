import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { guardStaffPage } from "@/lib/staffSession";
import PrintButton from "@/components/PrintButton";
import HotelVoucherDocument from "@/components/HotelVoucherDocument";
import { VISTA } from "@/lib/voucherBrand";
import QRCode from "qrcode";

export const dynamic = "force-dynamic";

export default async function HotelVoucherPage({ params }: { params: { id: string } }) {
  await guardStaffPage("hotels.voucher");
  const supabase = createClient();
  const { data: b } = await supabase
    .from("hotel_bookings")
    .select("*, parties:agent_id(name), hotels:hotel_id(name)")
    .eq("id", params.id).single();
  if (!b) notFound();

  const { data: stayRows } = await supabase
    .from("hotel_purchase_bookings")
    .select("hotel_name, city, check_in, check_out, nights, room_type, rooms, meal_plan, hcn, hotels:hotel_id(name)")
    .eq("booking_id", params.id).order("sort").order("created_at");
  const stays = (stayRows ?? []).map((s: any) => ({
    hotel_name: s.hotels?.name ?? s.hotel_name, city: s.city, check_in: s.check_in, check_out: s.check_out,
    nights: s.nights, room_type: s.room_type, rooms: s.rooms, meal_plan: s.meal_plan, hcn: s.hcn,
  }));
  const hcn = stays[0]?.hcn ?? null;

  const origin = process.env.NEXT_PUBLIC_SITE_URL || "";
  const qr = b.public_token ? await QRCode.toDataURL(`${origin}/hv/${b.public_token}`, { margin: 1, width: 200 }) : undefined;

  return (
    <div>
      <div className="no-print mb-4 flex justify-end"><PrintButton /></div>
      <HotelVoucherDocument
        provider={{ name: VISTA.name, tagline: VISTA.tagline, mobile: VISTA.mobile, email: VISTA.email, address: VISTA.address, logo: VISTA.logo }}
        booking={{
          booking_no: b.booking_no, guest_name: b.guest_name, group_no: b.group_no, agent: (b as any).parties?.name ?? null,
          hotel_name: (b as any).hotels?.name ?? b.hotel_name, city: b.city, check_in: b.check_in, check_out: b.check_out,
          nights: b.nights, room_type: b.room_type, rooms: b.rooms, guests: b.guests, meal_plan: b.meal_plan, hcn,
          stays,
        }}
        qr={qr}
      />
    </div>
  );
}
