import Link from "next/link";
import { guardStaffPage, docRightsFor } from "@/lib/staffSession";
import TradeVoucher from "@/components/accounting/TradeVoucher";
import AirTicketBookingsDashboard from "./AirTicketBookingsDashboard";

export const dynamic = "force-dynamic";

// Opens straight into a booking (?id=<uuid>, or ?id=new for a blank one) when
// linked from the dashboard's own rows or its "+ New Booking" button;
// otherwise this IS the dashboard. Sale Order has no list screen of its own —
// a clerk finds one by number — but a hold's whole point is staff following
// up before it expires, so this module gets the worklist Sale Order doesn't.
export default async function Page({ searchParams }: { searchParams: { id?: string } }) {
  const access = await guardStaffPage("accounting.view", "air_ticket_booking");
  const rights = docRightsFor(access, "air_ticket_booking");

  if (searchParams.id) {
    return (
      <div className="max-w-5xl space-y-3">
        <Link href="/accounting/sales/air-tickets" className="btn-outline text-sm">← Air Ticket Bookings</Link>
        <TradeVoucher type="air_ticket_booking" rights={rights}
          initialId={searchParams.id === "new" ? undefined : searchParams.id} />
      </div>
    );
  }

  return <AirTicketBookingsDashboard canCreate={!!rights.create} />;
}
