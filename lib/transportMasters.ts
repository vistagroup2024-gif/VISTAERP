import { createClient } from "@/lib/supabase/server";

// Shared master data needed by the transport booking form (new + edit).
export async function loadBookingMasters() {
  const sb = createClient();
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: routes }, { data: vehicles }, { data: packages }, { data: legs }, { data: agentRates }, { data: pkgPrices }, { data: agents }] =
    await Promise.all([
      sb.from("transport_routes").select("id, name, is_airport").eq("is_active", true).order("name"),
      sb.from("transport_vehicles").select("id, name").eq("is_active", true).order("sort_order").order("name"),
      sb.from("transport_packages").select("id, name, price, package_type").eq("is_active", true).order("name"),
      sb.from("transport_package_legs").select("package_id, seq, route_id, label, vehicle_id").order("seq"),
      // Currently-effective default selling rates (agent-agnostic) for the live
      // total display. The server resolves the authoritative agent+date rate on save.
      sb.from("transport_agent_rates").select("route_id, vehicle_id, selling_rate, effective_to")
        .is("agent_id", null).eq("status", "active").lte("effective_from", today)
        .order("effective_from", { ascending: false }),
      sb.from("transport_package_prices").select("package_id, vehicle_id, price"),
      sb.from("b2b_agents").select("id, agency_name").order("agency_name"),
    ]);

  const legsByPkg = new Map<string, any[]>();
  (legs ?? []).forEach((l: any) => {
    const arr = legsByPkg.get(l.package_id) ?? [];
    arr.push(l);
    legsByPkg.set(l.package_id, arr);
  });

  // Dedup to the latest effective rate per route+vehicle (still open on today).
  const rateSeen = new Set<string>();
  const rates = (agentRates ?? [])
    .filter((r: any) => !r.effective_to || r.effective_to >= today)
    .filter((r: any) => { const k = `${r.route_id}|${r.vehicle_id}`; if (rateSeen.has(k)) return false; rateSeen.add(k); return true; })
    .map((r: any) => ({ route_id: r.route_id, vehicle_id: r.vehicle_id, sell_rate: r.selling_rate }));

  return {
    routes: routes ?? [],
    vehicles: vehicles ?? [],
    packages: (packages ?? []).map((p: any) => ({ ...p, legs: legsByPkg.get(p.id) ?? [] })),
    rates,
    packagePrices: pkgPrices ?? [],
    companies: [] as any[],
    agents: agents ?? [],
  };
}
