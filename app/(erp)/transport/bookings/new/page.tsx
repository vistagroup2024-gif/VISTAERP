import PageHeader from "@/components/PageHeader";
import TransportBookingForm from "@/components/TransportBookingForm";
import { loadBookingMasters } from "@/lib/transportMasters";

export const dynamic = "force-dynamic";

export default async function NewBookingPage() {
  const m = await loadBookingMasters();
  return (
    <div className="max-w-5xl">
      <PageHeader title="New Transport Booking" />
      <TransportBookingForm existing={null} existingTrips={[]} {...m} />
    </div>
  );
}
