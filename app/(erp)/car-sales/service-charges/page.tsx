import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import ServiceChargesPanel from "./ServiceChargesPanel";

export const dynamic = "force-dynamic";

// Still its own URL. It is a tab of Sales Invoice now, which is where it is
// reached from, but the route stays so links and bookmarks keep working — and
// the guard stays here, because this is the door.
export default async function ServiceChargesPage() {
  await guardStaffPage("carsales.charges");
  return (
    <div>
      <PageHeader title="Monthly Service Charges" />
      <ServiceChargesPanel />
    </div>
  );
}
