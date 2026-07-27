import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import VendorManager from "./VendorManager";

export const dynamic = "force-dynamic";

export default async function VendorsPage() {
  const sb = createClient();
  const { data } = await sb.from("transport_vendors").select("id, name, contact_person, mobile, email, notes, is_active").order("name");
  return (
    <div className="max-w-4xl">
      <PageHeader title="Transport Vendors" />
      <p className="mb-4 text-sm text-slate-500">Outsourced-transport suppliers. Trips can be marked as outsourced to a vendor with a vendor cost.</p>
      <VendorManager initial={(data as any[]) ?? []} />
    </div>
  );
}
