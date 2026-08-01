import { createClient } from "@/lib/supabase/server";

// Shared master data needed by the transport booking form (new + edit).
export async function loadBookingMasters() {
  const sb = createClient();
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: routes }, { data: vehicles }, { data: packages }, { data: legs }, { data: agentRates }, { data: pkgPrices }, { data: agents }, { data: extras }] =
    await Promise.all([
      sb.from("transport_routes").select("id, name, is_airport, from_location, to_location").eq("is_active", true).order("name"),
      sb.from("transport_vehicles").select("id, name, seating_capacity").eq("is_active", true).order("sort_order").order("name"),
      sb.from("transport_packages").select("id, name, price, package_type").eq("is_active", true).order("name"),
      sb.from("transport_package_legs").select("package_id, seq, route_id, label, vehicle_id").order("seq"),
      // Currently-effective default selling rates (agent-agnostic) for the live
      // total display. The server resolves the authoritative agent+date rate on save.
      sb.from("transport_agent_rates").select("route_id, vehicle_id, selling_rate, effective_to")
        .is("agent_id", null).eq("status", "active").lte("effective_from", today)
        .order("effective_from", { ascending: false }),
      sb.from("transport_package_prices").select("package_id, vehicle_id, price"),
      // Customer/Agent master (parties) — not the B2B portal login list. Both
      // customers and agents can be billed for transport.
      sb.from("parties").select("id, name").in("party_type", ["customer", "b2b_agent"]).eq("is_active", true).order("name"),
      // Route + vehicle extra charges (e.g. Hajj Terminal) for the live total.
      sb.from("transport_route_rates").select("route_id, vehicle_id, extra_charge_desc, extra_charge_amount")
        .eq("extra_charge_enabled", true),
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

  const extraCharges = (extras ?? []).map((e: any) => ({
    route_id: e.route_id, vehicle_id: e.vehicle_id, desc: e.extra_charge_desc, amount: Number(e.extra_charge_amount),
  }));

  return {
    routes: routes ?? [],
    vehicles: vehicles ?? [],
    packages: (packages ?? []).map((p: any) => ({ ...p, legs: legsByPkg.get(p.id) ?? [] })),
    rates,
    packagePrices: pkgPrices ?? [],
    companies: [] as any[],
    // Normalize to { id, agency_name } so the booking form stays unchanged.
    agents: (agents ?? []).map((p: any) => ({ id: p.id, agency_name: p.name })),
    extraCharges,
  };
}
