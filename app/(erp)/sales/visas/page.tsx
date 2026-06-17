import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import VisaRow from "./VisaRow";

export const dynamic = "force-dynamic";

export default async function VisaTrackingPage() {
  const supabase = createClient();
  // Passengers on bookings that include a visa service line.
  const { data: pax } = await supabase
    .from("booking_pax")
    .select("id, full_name, passport_no, nationality, visa_type, visa_status, bookings:booking_id(booking_no, category)")
    .order("created_at", { ascending: false })
    .limit(500);

  const visaPax = (pax ?? []).filter((p: any) =>
    p.bookings?.category === "visa_only" || p.bookings?.category === "visa_transport" || p.visa_type
  );
  const rows = visaPax.length > 0 ? visaPax : (pax ?? []);

  return (
    <div>
      <PageHeader title="Visa Tracking" />
      <p className="mb-4 text-sm text-slate-500">Track visa status per passenger. Change the status inline.</p>
      <div className="card overflow-hidden p-0">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Passenger</th>
              <th className="th">Passport</th>
              <th className="th">Nationality</th>
              <th className="th">Visa type</th>
              <th className="th">Order</th>
              <th className="th">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p: any) => (
              <VisaRow
                key={p.id}
                id={p.id}
                name={p.full_name}
                passport={p.passport_no}
                nationality={p.nationality}
                visaType={p.visa_type}
                bookingNo={p.bookings?.booking_no ?? null}
                status={p.visa_status}
              />
            ))}
            {rows.length === 0 && (
              <tr><td className="td text-slate-400" colSpan={6}>No passengers yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
