import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import RateMaster from "./RateMaster";

export const dynamic = "force-dynamic";

export default async function RateMasterPage() {
  const sb = createClient();
  const [{ data: routes }, { data: vehicles }, { data: agents }, { data: vendors }, { data: agentRates }, { data: vendorRates }] =
    await Promise.all([
      sb.from("transport_routes").select("id, name").eq("is_active", true).order("name"),
      sb.from("transport_vehicles").select("id, name").eq("is_active", true).order("sort_order").order("name"),
      sb.from("b2b_agents").select("id, agency_name").order("agency_name"),
      sb.from("transport_vendors").select("id, name").eq("is_active", true).order("name"),
      sb.from("transport_agent_rates").select("id, agent_id, route_id, vehicle_id, effective_from, effective_to, selling_rate, status").order("effective_from", { ascending: false }),
      sb.from("transport_vendor_rates").select("id, vendor_id, route_id, vehicle_id, effective_from, effective_to, purchase_rate, status").order("effective_from", { ascending: false }),
    ]);

  return (
    <div className="max-w-6xl">
      <PageHeader title="Rate Master" />
      <p className="mb-4 text-sm text-slate-500">
        Effective-dated selling rates (per agent) and vendor purchase rates. When a rate changes, add a new
        record with a new effective date — historical rates are preserved. Bookings use the rate effective on the booking date.
      </p>
      <RateMaster
        routes={(routes as any[]) ?? []}
        vehicles={(vehicles as any[]) ?? []}
        agents={(agents as any[]) ?? []}
        vendors={(vendors as any[]) ?? []}
        agentRates={(agentRates as any[]) ?? []}
        vendorRates={(vendorRates as any[]) ?? []}
      />
    </div>
  );
}
