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
      // All active selling rates with their effective window — the form resolves
      // the rate for the selected agent AND the booking date (supports back-dated
      // bookings), matching what the server saves.
      sb.from("transport_agent_rates").select("agent_id, route_id, vehicle_id, selling_rate, effective_from, effective_to")
        .eq("status", "active")
        .order("effective_from", { ascending: false }),
      // Standard (agent_id null) + agent-specific package prices; the form picks
      // the selected agent's price, else the standard one.
      sb.from("transport_package_prices").select("package_id, vehicle_id, price, agent_id"),
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

  // Keep every active rate row (agent-specific + default) with its effective
  // window; the form resolves the right one per agent + booking date.
  const rates = (agentRates ?? []).map((r: any) => ({
    agent_id: r.agent_id ?? null, route_id: r.route_id, vehicle_id: r.vehicle_id,
    sell_rate: r.selling_rate, effective_from: r.effective_from ?? null, effective_to: r.effective_to ?? null,
  }));

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
