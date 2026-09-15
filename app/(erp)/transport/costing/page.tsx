import { createClient } from "@/lib/supabase/server";
import { COMPANY_ID } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import CostingModule from "./CostingModule";

export const dynamic = "force-dynamic";

export default async function TransportCostingPage() {
  const sb = createClient();
  const [{ data: vehicles }, { data: routes }] = await Promise.all([
    sb.rpc("transport_vista_vehicles", { p_company: COMPANY_ID }),
    sb.from("transport_routes").select("id, name, from_location, to_location, distance_km").eq("is_active", true).order("name"),
  ]);

  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader title="Transport Costing & Pricing" />
      <p className="text-sm text-slate-500">
        A decision-support tool built entirely from the ERP&apos;s own data — routes, vehicles, drivers, trips and
        posted accounting vouchers. It never invents a number: where the history is not there yet, it says so instead
        of guessing. Vehicles are the plates under Accounting → Tag Areas → Vehicles → VISTA TRANSPORT; a plate&apos;s
        cost comes from any posted voucher line tagged to it, and its trips come from whichever driver has that
        plate set as their Registration No on Transport → Drivers.
      </p>
      <CostingModule vehicles={(vehicles as any[]) ?? []} routes={(routes as any[]) ?? []} />
    </div>
  );
}
