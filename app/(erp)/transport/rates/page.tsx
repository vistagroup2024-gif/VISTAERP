import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { getStaffAccess } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import RateMaster from "./RateMaster";

export const dynamic = "force-dynamic";

export default async function RateMasterPage() {
  const sb = createClient();
  // Deleting a rate period is admin-only in the database; the button follows, so
  // the screen never offers what the RPC behind it will refuse.
  const access = await getStaffAccess();
  const [{ data: routes }, { data: vehicles }, { data: agents }, { data: vendors }, { data: agentRates }, { data: vendorRates }, { data: routeRates }] =
    await Promise.all([
      sb.from("transport_routes").select("id, name").eq("is_active", true).order("name"),
      sb.from("transport_vehicles").select("id, name").eq("is_active", true).order("sort_order").order("name"),
      // Customer/Agent master (parties) — agent-specific rates are keyed here,
      // consistent with the rest of transport (not the B2B login list).
      sb.from("parties").select("id, name").in("party_type", ["customer", "b2b_agent"]).eq("is_active", true).order("name"),
      sb.from("transport_vendors").select("id, name").eq("is_active", true).order("name"),
      // Paged: 735 rows already, against PostgREST's silent 1000-row cap. A
      // short read here would drop rates off the Rate Master and out of Old
      // rates without any sign that it had. Paging needs a total order, so it
      // is by id and the table sorts itself for display.
      fetchAllRows<any>((from, to) =>
        sb.from("transport_agent_rates").select("id, agent_id, route_id, vehicle_id, effective_from, effective_to, selling_rate, status")
          .order("id").range(from, to)),
      sb.from("transport_vendor_rates").select("id, vendor_id, route_id, vehicle_id, effective_from, effective_to, purchase_rate, status").order("effective_from", { ascending: false }),
      sb.from("transport_route_rates").select("id, route_id, vehicle_id, extra_charge_enabled, extra_charge_desc, extra_charge_amount"),
    ]);
  // Who the Agent Fare Chart tab can show a chart for: a party with a portal
  // login, or one priced differently from the standard.
  const { data: chartParties } = await sb.rpc("transport_rate_chart_parties");

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
        agents={((agents as any[]) ?? []).map((a) => ({ id: a.id, agency_name: a.name }))}
        vendors={(vendors as any[]) ?? []}
        // Paging asked for id order; the table below has always read newest
        // first, so the order it is shown in is restored here.
        agentRates={((agentRates as any[]) ?? []).slice().sort(
          (a, b) => String(b.effective_from ?? "").localeCompare(String(a.effective_from ?? "")))}
        vendorRates={(vendorRates as any[]) ?? []}
        routeRates={(routeRates as any[]) ?? []}
        chartParties={(chartParties as any[]) ?? []}
        isAdmin={access.isAdmin}
      />
    </div>
  );
}
