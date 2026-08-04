import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import VendorManager from "./VendorManager";

export const dynamic = "force-dynamic";

export default async function VendorsPage() {
  const sb = createClient();
  const [{ data }, { data: vehicles }] = await Promise.all([
    sb.from("transport_vendors").select("id, name, vendor_type, contact_person, mobile, email, notes, username, is_active, vehicle_ids").order("name"),
    sb.from("transport_vehicles").select("id, name, seating_capacity").eq("is_active", true).order("name"),
  ]);
  return (
    <div className="max-w-5xl">
      <PageHeader title="Transport Vendors" />
      <p className="mb-4 text-sm text-slate-500">Outsourced-transport suppliers. Trips can be marked as outsourced to a vendor with a vendor cost. Set each vendor&apos;s vehicles so they can only be assigned matching trips.</p>
      <VendorManager initial={(data as any[]) ?? []} vehicles={(vehicles as any[]) ?? []} />
    </div>
  );
}
