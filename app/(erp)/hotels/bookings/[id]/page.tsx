import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { guardStaffPage, staffCan } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import HotelBookingDetail from "./HotelBookingDetail";

export const dynamic = "force-dynamic";

export default async function HotelBookingDetailPage({ params }: { params: { id: string } }) {
  const access = await guardStaffPage("hotels.bookings");
  const supabase = createClient();

  const { data: b } = await supabase
    .from("hotel_bookings")
    .select("*, parties:agent_id(name), hotels:hotel_id(name)")
    .eq("id", params.id).single();
  if (!b) notFound();

  const [{ data: stays }, { data: rooms }, { data: suppliers }, { data: hotels }, { data: tl }] = await Promise.all([
    supabase.from("hotel_purchase_bookings").select("*, supplier:supplier_id(name)").eq("booking_id", params.id).order("sort").order("created_at"),
    supabase.from("hotel_stay_rooms").select("*").eq("booking_id", params.id).order("sort"),
    supabase.from("parties").select("id, name").eq("party_type", "supplier").eq("is_active", true).order("name"),
    supabase.from("hotels").select("id, name").eq("is_active", true).order("name"),
    supabase.from("audit_log").select("id, action, detail, created_at").eq("entity", "hotel_booking").eq("entity_id", params.id).order("created_at", { ascending: false }).limit(100),
  ]);
  const roomsByStay = new Map<string, any[]>();
  for (const r of (rooms ?? []) as any[]) { const a = roomsByStay.get(r.stay_id) ?? []; a.push(r); roomsByStay.set(r.stay_id, a); }
  const staysWithRooms = ((stays ?? []) as any[]).map((s) => ({ ...s, rooms_detail: roomsByStay.get(s.id) ?? [] }));

  const perms = {
    canEdit: staffCan(access, "hotels.bookings"),
    canPurchase: staffCan(access, "hotels.purchase"),
    canPurchaseRate: staffCan(access, "hotels.purchase_rate"),
    canProfit: staffCan(access, "hotels.profit"),
    canHcn: staffCan(access, "hotels.hcn"),
    canCancel: staffCan(access, "hotels.cancel"),
    canPayable: staffCan(access, "hotels.payable"),
    canVoucher: staffCan(access, "hotels.voucher"),
    canSupplier: staffCan(access, "hotels.suppliers") || staffCan(access, "hotels.purchase"),
  };

  const booking = {
    ...b,
    agent_name: (b as any).parties?.name ?? null,
    hotel_display: (b as any).hotels?.name ?? b.hotel_name ?? null,
  };

  return (
    <div className="max-w-5xl">
      <RealtimeRefresh tables={["hotel_bookings", "hotel_purchase_bookings"]} />
      <PageHeader title={`Hotel Booking ${b.booking_no}`} />
      <HotelBookingDetail
        booking={booking}
        stays={staysWithRooms as any}
        suppliers={(suppliers ?? []) as any}
        hotels={(hotels ?? []) as any}
        perms={perms}
        timeline={(tl ?? []) as any}
      />
    </div>
  );
}
