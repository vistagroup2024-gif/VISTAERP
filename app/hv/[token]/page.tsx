import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import HotelVoucherDocument from "@/components/HotelVoucherDocument";
import { VISTA } from "@/lib/voucherBrand";

export const dynamic = "force-dynamic";

// Public, login-free hotel voucher (shared via QR). Reads ONLY client-safe fields
// through the SECURITY DEFINER RPC public_hotel_voucher — no supplier/cost/profit.
export default async function PublicHotelVoucher({ params }: { params: { token: string } }) {
  const supabase = createClient();
  const { data } = await supabase.rpc("public_hotel_voucher", { p_token: params.token });
  if (!data) notFound();
  const v = data as any;
  return (
    <div className="min-h-screen bg-slate-100 py-8">
      <HotelVoucherDocument
        provider={{ name: VISTA.name, tagline: VISTA.tagline, mobile: VISTA.mobile, email: VISTA.email, address: VISTA.address, logo: VISTA.logo }}
        booking={{
          booking_no: v.booking_no, guest_name: v.guest_name, group_no: v.group_no, agent: v.agent,
          hotel_name: v.hotel_name, city: v.city, check_in: v.check_in, check_out: v.check_out,
          nights: v.nights, room_type: v.room_type, rooms: v.rooms, guests: v.guests, meal_plan: v.meal_plan, hcn: v.hcn,
          stays: v.stays,
        }}
      />
    </div>
  );
}
