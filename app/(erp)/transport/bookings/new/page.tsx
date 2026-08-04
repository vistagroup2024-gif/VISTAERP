import PageHeader from "@/components/PageHeader";
import TransportBookingForm from "@/components/TransportBookingForm";
import { loadBookingMasters } from "@/lib/transportMasters";

export const dynamic = "force-dynamic";

export default async function NewBookingPage({ searchParams }: { searchParams: { nusuk?: string; pax?: string } }) {
  const m = await loadBookingMasters();
  return (
    <div className="max-w-5xl">
      <PageHeader title="New Transport Booking" />
      <TransportBookingForm existing={null} existingTrips={[]} {...m}
        prefill={{ nusuk_group_no: searchParams.nusuk, pax: searchParams.pax }} />
    </div>
  );
}
