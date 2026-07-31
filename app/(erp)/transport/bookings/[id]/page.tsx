import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import TransportBookingForm from "@/components/TransportBookingForm";
import BookingStatusBar from "./BookingStatusBar";
import DeleteBookingButton from "./DeleteBookingButton";
import BookingExtras from "./BookingExtras";
import { loadBookingMasters } from "@/lib/transportMasters";

export const dynamic = "force-dynamic";

export default async function EditBookingPage({ params }: { params: { id: string } }) {
  const sb = createClient();
  const [{ data: booking }, { data: trips }, { data: rating }, masters] = await Promise.all([
    sb.from("transport_bookings").select("*").eq("id", params.id).maybeSingle(),
    sb.from("transport_trips").select("*").eq("booking_id", params.id).order("seq"),
    sb.from("transport_ratings").select("rating, feedback").eq("booking_id", params.id).maybeSingle(),
    loadBookingMasters(),
  ]);

  if (!booking) {
    return <div className="card text-slate-500">Booking not found. <Link href="/transport/bookings" className="text-brand hover:underline">Back</Link></div>;
  }
  const b = booking as any;

  return (
    <div className="max-w-5xl">
      <PageHeader title={`Booking ${b.booking_no ?? ""}`}>
        <Link href={`/transport/bookings/${b.id}/voucher?brand=vista`} className="btn-outline">Vista Voucher</Link>
        <Link href={`/transport/bookings/${b.id}/voucher?brand=agent`} className="btn-outline">Agent Voucher</Link>
        <Link href="/transport/bookings" className="btn-outline">All bookings</Link>
        <DeleteBookingButton bookingId={b.id} bookingNo={b.booking_no ?? b.id} />
      </PageHeader>
      <BookingStatusBar id={b.id} status={b.status} />
      <BookingExtras
        booking={{ id: b.id, booking_no: b.booking_no, passenger_name: b.passenger_name, mobile: b.mobile, whatsapp: b.whatsapp, status: b.status }}
        driverId={((trips as any[]) ?? []).find((t: any) => t.driver_id)?.driver_id ?? null}
        rating={(rating as any) ?? null}
      />
      <div className="mt-4">
        <TransportBookingForm existing={b} existingTrips={(trips as any[]) ?? []} {...masters} />
      </div>
    </div>
  );
}
