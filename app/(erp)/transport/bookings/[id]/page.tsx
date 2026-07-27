import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import TransportBookingForm from "@/components/TransportBookingForm";
import BookingStatusBar from "./BookingStatusBar";
import { loadBookingMasters } from "@/lib/transportMasters";

export const dynamic = "force-dynamic";

export default async function EditBookingPage({ params }: { params: { id: string } }) {
  const sb = createClient();
  const [{ data: booking }, { data: trips }, masters] = await Promise.all([
    sb.from("transport_bookings").select("*").eq("id", params.id).maybeSingle(),
    sb.from("transport_trips").select("*").eq("booking_id", params.id).order("seq"),
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
      </PageHeader>
      <BookingStatusBar id={b.id} status={b.status} />
      <div className="mt-4">
        <TransportBookingForm existing={b} existingTrips={(trips as any[]) ?? []} {...masters} />
      </div>
    </div>
  );
}
