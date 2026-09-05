// The agent fare chart, shaped once.
//
// An agent signs in and sees this chart; the office sees the same one from
// Transport → Agent Fare Chart. Both start from the same jsonb — the portal's
// b2b_transport_masters(), the office's transport_agent_rate_chart(), which
// resolve every price through the SAME two database functions — and both shape
// it here. Shape it twice and the two drift: a column ordered differently, a
// blank row kept on one side and dropped on the other, and the office stops
// being able to say "this is what they are looking at".

export interface Veh { id: string; name: string }
export interface ChartRow { id: string; name: string; cells: (number | null)[] }
export interface RateChart {
  routeVehicles: Veh[]; routeRows: ChartRow[];
  packageVehicles: Veh[]; packageRows: ChartRow[];
}

// Fixed vehicle-column order: Camry, Starex, Staria, GMC, Hiace, Coaster, Bus.
// The chart is read across, so the columns must not move about between agents
// just because one of them has no rate for a vehicle the next one does.
const ORDER = ["camry", "starex", "staria", "gmc", "hiace", "coaster", "bus"];
const vrank = (name: string) => {
  const n = (name ?? "").toLowerCase();
  const i = ORDER.findIndex((k) => n.includes(k));
  return i < 0 ? 99 : i;
};

// One matrix: rows priced against the vehicle columns that any of them use.
// A vehicle nobody is priced for is not a column, and a row with no price at
// all is not a row — an empty line in a price list is worse than no line.
function matrix(rows: { id: string; name: string }[], vehicles: Veh[], price: Map<string, number>) {
  const cols = vehicles.filter((v) => rows.some((r) => price.has(`${r.id}|${v.id}`)));
  const out = rows
    .map((r) => ({ id: r.id, name: r.name, cells: cols.map((v) => price.get(`${r.id}|${v.id}`) ?? null) }))
    .filter((r) => r.cells.some((c) => c != null));
  return { cols: cols.map((v) => ({ id: v.id, name: v.name })), rows: out };
}

export function buildRateChart(masters: any): RateChart {
  const m = masters ?? {};
  const vehicles: Veh[] = [...(m.vehicles ?? [])].sort(
    (a: any, b: any) => vrank(a.name) - vrank(b.name) || String(a.name).localeCompare(String(b.name)),
  );

  // Route rates — already resolved to this agent's price, keyed by route|vehicle.
  const rate = new Map<string, number>();
  (m.rates ?? []).forEach((r: any) => {
    if (r.sell_rate != null) rate.set(`${r.route_id}|${r.vehicle_id}`, Number(r.sell_rate));
  });
  const routes = matrix(m.routes ?? [], vehicles, rate);

  // Package prices — keyed by package|vehicle.
  const pkg = new Map<string, number>();
  (m.packagePrices ?? []).forEach((p: any) => {
    if (p.price != null) pkg.set(`${p.package_id}|${p.vehicle_id}`, Number(p.price));
  });
  const packages = matrix(m.packages ?? [], vehicles, pkg);

  return {
    routeVehicles: routes.cols, routeRows: routes.rows,
    packageVehicles: packages.cols, packageRows: packages.rows,
  };
}
