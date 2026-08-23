import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import TransportBookingForm from "@/components/TransportBookingForm";
import BookingStatusBar from "./BookingStatusBar";
import DeleteBookingButton from "./DeleteBookingButton";
import BookingExtras from "./BookingExtras";
import BookingTripsCancel from "./BookingTripsCancel";
import CancelRequestBar from "./CancelRequestBar";
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
      {b.cancel_requested && b.status !== "cancelled" && <CancelRequestBar id={b.id} reason={b.cancel_reason ?? null} />}
      <BookingStatusBar id={b.id} status={b.status} />
      <BookingExtras
        booking={{ id: b.id, booking_no: b.booking_no, passenger_name: b.passenger_name, mobile: b.mobile, whatsapp: b.whatsapp, status: b.status }}
        driverId={((trips as any[]) ?? []).find((t: any) => t.driver_id)?.driver_id ?? null}
        rating={(rating as any) ?? null}
      />
      <div className="mt-4">
        <TransportBookingForm existing={b} existingTrips={(trips as any[]) ?? []} {...masters} />
      </div>

      <BookingTripsCancel bookingId={b.id} trips={(trips as any[]) ?? []} isPackage={b.booking_type === "package"} />


      {b.booking_type === "package" && ((trips as any[]) ?? []).length > 0 && (
        <div className="card mt-4">
          <h2 className="font-semibold text-slate-700">📊 Package Fare Distribution <span className="text-xs font-normal text-slate-400">(internal — not shown to agents)</span></h2>
          <p className="mt-1 text-xs text-slate-500">The package price is spread across trips by the same discount %, adjusting the last trip for rounding so the trips total the package price exactly.</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr><th className="px-3 py-2">#</th><th className="px-3 py-2">Trip</th><th className="px-3 py-2 text-right">Normal Fare</th><th className="px-3 py-2 text-right">Discount %</th><th className="px-3 py-2 text-right">Final Fare</th></tr>
              </thead>
              <tbody>
                {((trips as any[]) ?? []).map((t: any, i: number) => {
                  const normal = Number(t.normal_rate ?? t.sell_rate ?? 0);
                  const final = Number(t.sell_rate ?? 0);
                  const pct = normal > 0 ? (1 - final / normal) * 100 : 0;
                  return (
                    <tr key={t.id ?? i} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-slate-500">{t.seq ?? i + 1}</td>
                      <td className="px-3 py-2 font-medium text-slate-800">{t.route_label ?? t.route_name ?? "Trip"}</td>
                      <td className="px-3 py-2 text-right text-slate-500">{normal.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right text-slate-500">{pct > 0.0001 ? `${pct.toFixed(3)}%` : "—"}</td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-800">{final.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 font-semibold">
                  <td className="px-3 py-2" colSpan={2}>Package Total</td>
                  <td className="px-3 py-2 text-right text-slate-500">{((trips as any[]) ?? []).reduce((s: number, t: any) => s + Number(t.normal_rate ?? t.sell_rate ?? 0), 0).toFixed(2)}</td>
                  <td className="px-3 py-2"></td>
                  <td className="px-3 py-2 text-right text-brand-dark">{((trips as any[]) ?? []).reduce((s: number, t: any) => s + Number(t.sell_rate ?? 0), 0).toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
