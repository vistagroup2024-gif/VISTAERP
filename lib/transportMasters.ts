import { createClient } from "@/lib/supabase/server";

// Shared master data needed by the transport booking form (new + edit).
export async function loadBookingMasters() {
  const sb = createClient();
  const [{ data: routes }, { data: vehicles }, { data: packages }, { data: legs }, { data: rates }, { data: pkgPrices }, { data: companies }, { data: agents }] =
    await Promise.all([
      sb.from("transport_routes").select("id, name, is_airport").eq("is_active", true).order("name"),
      sb.from("transport_vehicles").select("id, name").eq("is_active", true).order("sort_order").order("name"),
      sb.from("transport_packages").select("id, name, price, package_type").eq("is_active", true).order("name"),
      sb.from("transport_package_legs").select("package_id, seq, route_id, label, vehicle_id").order("seq"),
      sb.from("transport_route_rates").select("route_id, vehicle_id, sell_rate"),
      sb.from("transport_package_prices").select("package_id, vehicle_id, price"),
      sb.from("group_companies").select("id, name").eq("is_active", true).order("name"),
      sb.from("b2b_agents").select("id, agency_name").order("agency_name"),
    ]);

  const legsByPkg = new Map<string, any[]>();
  (legs ?? []).forEach((l: any) => {
    const arr = legsByPkg.get(l.package_id) ?? [];
    arr.push(l);
    legsByPkg.set(l.package_id, arr);
  });

  return {
    routes: routes ?? [],
    vehicles: vehicles ?? [],
    packages: (packages ?? []).map((p: any) => ({ ...p, legs: legsByPkg.get(p.id) ?? [] })),
    rates: rates ?? [],
    packagePrices: pkgPrices ?? [],
    companies: companies ?? [],
    agents: agents ?? [],
  };
}
