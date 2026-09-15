"use client";

import { Fragment, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID, dateStr } from "@/lib/format";
import { todaySA } from "@/lib/saudiTime";
import SearchSelect from "@/components/ui/SearchSelect";

type Vehicle = {
  id: string; name: string; category: string | null; vehicle_type: string | null;
  seating_capacity: number | null; is_active: boolean;
  purchase_price: number | null; purchase_date: string | null; model_year: number | null;
  expected_life_km: number | null; expected_life_years: number | null; expected_resale_value: number | null;
  depreciation_enabled: boolean; tyre_cost: number | null; tyre_life_km: number | null;
  oil_change_cost: number | null; oil_change_interval_km: number | null; overhead_manual_monthly: number | null;
};
type Route = { id: string; name: string; from_location: string | null; to_location: string | null; distance_km: number | null };

const sar = (n: any) => `${Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SAR`;
const km2 = (n: any) => n === null || n === undefined ? "—" : `${Number(n).toLocaleString("en-US", { maximumFractionDigits: 1 })} km`;
const cpk = (n: any) => n === null || n === undefined ? "—" : `${Number(n).toFixed(4)} SAR/km`;
const pct = (n: any) => n === null || n === undefined ? "—" : `${Number(n).toFixed(1)}%`;

const PERIODS = [
  ["current_month", "Current month"], ["previous_month", "Previous month"],
  ["last_3_months", "Last 3 months"], ["last_6_months", "Last 6 months (default)"],
  ["last_12_months", "Last 12 months"], ["custom", "Custom range"],
] as const;

const TABS = [
  ["calc", "Calculator"], ["compare", "Route Comparison"], ["vehicle", "Vehicle Performance"],
  ["route", "Route Profitability"], ["fleet", "Fleet Overview"], ["dashboard", "Dashboard"],
  ["snapshots", "Snapshots"], ["profiles", "Vehicle Cost Profiles"],
] as const;
type Tab = typeof TABS[number][0];

function ConfidenceBadge({ c }: { c: any }) {
  if (!c) return null;
  const level = c.level as string;
  const cls = level === "high" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : level === "medium" ? "bg-amber-50 text-amber-700 border-amber-200"
    : "bg-red-50 text-red-700 border-red-200";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}
      title={`Data used: ${c.months_of_data} months / ${c.trips_of_data} trips`}>
      {level.toUpperCase()} CONFIDENCE <span className="font-normal opacity-70">· {c.months_of_data}mo / {c.trips_of_data} trips</span>
    </span>
  );
}

function PeriodPicker({ period, setPeriod, from, setFrom, to, setTo }: {
  period: string; setPeriod: (v: string) => void; from: string; setFrom: (v: string) => void; to: string; setTo: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div><label className="label">Costing Period</label>
        <select className="input" value={period} onChange={(e) => setPeriod(e.target.value)}>
          {PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      {period === "custom" && <>
        <div><label className="label">From</label><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label className="label">To</label><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </>}
    </div>
  );
}

const COMP_LABELS: Record<string, string> = {
  fuel: "Fuel", driver: "Driver", oil_service: "Oil / Service", tyres: "Tyres", maintenance: "Maintenance",
  insurance_registration: "Insurance / Registration", nusuk: "Nusuk", other: "Other",
  depreciation: "Vehicle Depreciation", overhead: "Fleet Overhead",
};
const SRC_NOTE: Record<string, string> = {
  actual: "actual history", lifecycle_model: "lifecycle model", lifecycle_model_km: "lifecycle model (KM)",
  lifecycle_model_years: "lifecycle model (years)", override: "manual override ⚠", insufficient_data: "insufficient data",
  not_configured: "not configured", disabled: "disabled", equal: "equal split", by_km: "by KM", by_revenue: "by revenue",
  by_active_days: "by active days", manual: "manual",
};

function BreakdownTable({ components }: { components: any[] }) {
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead className="bg-slate-50"><tr>
          <th className="th">Component</th><th className="th text-right">Monthly Cost</th>
          <th className="th text-right">Cost / KM</th><th className="th">Trip Cost Basis</th><th className="th">Source</th>
        </tr></thead>
        <tbody>
          {(components ?? []).map((c: any) => (
            <tr key={c.key} className="border-t border-slate-100">
              <td className="td font-medium">{COMP_LABELS[c.key] ?? c.label}</td>
              <td className="td text-right tabular-nums">{sar(c.monthly_cost)}</td>
              <td className="td text-right tabular-nums">{cpk(c.cost_per_km)}</td>
              <td className="td text-slate-400">{c.driver_name ? `Driver: ${c.driver_name}` : "—"}</td>
              <td className="td">
                <span className={c.source === "override" ? "font-medium text-amber-700" : c.source === "insufficient_data" ? "text-slate-400" : "text-slate-600"}>
                  {SRC_NOTE[c.source] ?? c.source}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Warnings({ warnings }: { warnings: string[] }) {
  if (!warnings?.length) return null;
  return (
    <div className="space-y-2">
      {warnings.map((w, i) => (
        <div key={i} className={`rounded-md border px-3 py-2 text-sm font-medium ${w.startsWith("LOSS") ? "border-red-300 bg-red-50 text-red-700" : "border-amber-300 bg-amber-50 text-amber-700"}`}>
          {w}
        </div>
      ))}
    </div>
  );
}

export default function CostingModule({ vehicles, routes }: { vehicles: Vehicle[]; routes: Route[] }) {
  const supabase = createClient();
  const [tab, setTab] = useState<Tab>("calc");

  const [period, setPeriod] = useState("last_6_months");
  const [from, setFrom] = useState(todaySA());
  const [to, setTo] = useState(todaySA());

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`rounded-t-md px-3 py-2 text-sm font-medium ${tab === k ? "border-b-2 border-brand text-brand" : "text-slate-500 hover:text-slate-700"}`}>
            {l}
          </button>
        ))}
      </div>

      {tab === "calc" && <CalculatorTab vehicles={vehicles} routes={routes} period={period} setPeriod={setPeriod} from={from} setFrom={setFrom} to={to} setTo={setTo} supabase={supabase} />}
      {tab === "compare" && <CompareTab routes={routes} period={period} setPeriod={setPeriod} from={from} setFrom={setFrom} to={to} setTo={setTo} supabase={supabase} />}
      {tab === "vehicle" && <VehiclePerfTab vehicles={vehicles} period={period} setPeriod={setPeriod} from={from} setFrom={setFrom} to={to} setTo={setTo} supabase={supabase} />}
      {tab === "route" && <RouteProfitTab routes={routes} period={period} setPeriod={setPeriod} from={from} setFrom={setFrom} to={to} setTo={setTo} supabase={supabase} />}
      {tab === "fleet" && <FleetTab period={period} setPeriod={setPeriod} from={from} setFrom={setFrom} to={to} setTo={setTo} supabase={supabase} />}
      {tab === "dashboard" && <DashboardTab period={period} setPeriod={setPeriod} from={from} setFrom={setFrom} to={to} setTo={setTo} supabase={supabase} />}
      {tab === "snapshots" && <SnapshotsTab supabase={supabase} />}
      {tab === "profiles" && <ProfilesTab vehicles={vehicles} supabase={supabase} />}
    </div>
  );
}

// ── Calculator (Mode 1) ──────────────────────────────────────────────────
function CalculatorTab({ vehicles, routes, period, setPeriod, from, setFrom, to, setTo, supabase }: any) {
  const [vehicleId, setVehicleId] = useState<string>(vehicles[0]?.id ?? "");
  const [routeId, setRouteId] = useState<string>(routes[0]?.id ?? "");
  const [tripType, setTripType] = useState("one_way");
  const [returnCond, setReturnCond] = useState("historical");
  const [manualEmpty, setManualEmpty] = useState("");
  const [showOverrides, setShowOverrides] = useState(false);
  const [ov, setOv] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [sellPrice, setSellPrice] = useState("");
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  async function calculate() {
    if (!vehicleId || !routeId) { setError("Choose a vehicle and a route."); return; }
    setBusy(true); setError(null); setSavedMsg(null);
    const overrides: Record<string, any> = {};
    for (const [k, v] of Object.entries(ov)) if (v !== "" && v !== undefined) overrides[k] = k === "overhead_method" ? v : Number(v);
    if (manualEmpty !== "") overrides.return_pct_override = manualEmpty;
    const { data, error: err } = await supabase.rpc("transport_costing_calculate", {
      p_company: COMPANY_ID, p_vehicle_id: vehicleId, p_route_id: routeId,
      p_period: period, p_period_from: period === "custom" ? from : null, p_period_to: period === "custom" ? to : null,
      p_trip_type: tripType, p_return_condition: returnCond, p_overrides: overrides,
    });
    setBusy(false);
    if (err) return setError(err.message);
    setResult(data);
    setSellPrice(data?.pricing?.recommended_price ? String(data.pricing.recommended_price) : "");
  }

  async function saveSnapshot() {
    if (!result) return;
    setBusy(true); setError(null);
    const { error: err } = await supabase.rpc("transport_costing_snapshot_save", {
      p_label: `${result.vehicle?.name ?? ""} — ${result.route?.name ?? ""}`, p_vehicle_id: vehicleId, p_route_id: routeId,
      p_trip_type: tripType, p_return_condition: returnCond, p_period_label: period,
      p_period_from: result.period?.from, p_period_to: result.period?.to,
      p_result: result, p_selling_price: sellPrice ? Number(sellPrice) : null, p_overrides: result.overrides_applied ?? {},
    });
    setBusy(false);
    if (err) return setError(err.message);
    setSavedMsg("Snapshot saved.");
  }

  const revenue = Number(sellPrice) || 0;
  const cost = Number(result?.trip_cost ?? 0);
  const profit = revenue - cost;
  const margin = revenue > 0 ? (100 * profit) / revenue : null;
  const minMargin = result?.pricing?.min_margin_pct ?? 0;
  const simWarnings: string[] = [];
  if (sellPrice && revenue > 0 && revenue < cost) simWarnings.push("LOSS WARNING — Selling price is below estimated cost.");
  else if (sellPrice && margin !== null && margin < minMargin) simWarnings.push(`LOW MARGIN — This booking (${margin.toFixed(1)}%) is below Vista's minimum target margin (${minMargin}%).`);

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div><label className="label">Vehicle</label>
            <SearchSelect value={vehicleId} onChange={setVehicleId} placeholder="Choose a vehicle…"
              options={vehicles.map((v: Vehicle) => ({ value: v.id, label: `${v.name}${v.category ? " (" + v.category + ")" : ""}` }))} /></div>
          <div><label className="label">Route</label>
            <SearchSelect value={routeId} onChange={setRouteId} placeholder="Choose a route…"
              options={routes.map((r: Route) => ({ value: r.id, label: `${r.name}${r.distance_km ? " — " + r.distance_km + " km" : ""}` }))} /></div>
          <PeriodPicker period={period} setPeriod={setPeriod} from={from} setFrom={setFrom} to={to} setTo={setTo} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div><label className="label">Trip Type</label>
            <select className="input" value={tripType} onChange={(e) => setTripType(e.target.value)}>
              <option value="one_way">One Way</option><option value="return">Return</option>
              <option value="round_trip">Round Trip</option><option value="multi_leg">Multi-leg</option>
              <option value="custom">Custom</option>
            </select></div>
          {tripType === "one_way" && <>
            <div><label className="label">Return Condition</label>
              <select className="input" value={returnCond} onChange={(e) => setReturnCond(e.target.value)}>
                <option value="paid">Return with passenger / paid trip</option>
                <option value="empty">Return empty</option>
                <option value="historical">Unknown / use historical probability</option>
              </select></div>
            {returnCond === "historical" && (
              <div><label className="label">Override empty-return % <span className="font-normal text-slate-400">(optional)</span></label>
                <input className="input" inputMode="decimal" placeholder="historical value used if blank" value={manualEmpty} onChange={(e) => setManualEmpty(e.target.value)} /></div>
            )}
          </>}
        </div>
        <button type="button" onClick={() => setShowOverrides((s) => !s)} className="text-sm text-brand hover:underline">
          {showOverrides ? "Hide" : "Show"} manual overrides
        </button>
        {showOverrides && (
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3 sm:grid-cols-4">
            {[["fuel_cost_per_km", "Fuel SAR/km"], ["oil_cost_per_km", "Oil SAR/km"], ["tyre_cost_per_km", "Tyre SAR/km"],
              ["maintenance_monthly", "Maintenance/mo"], ["utilization_km", "Monthly KM"]].map(([k, l]) => (
              <div key={k}><label className="label">{l}</label>
                <input className="input" inputMode="decimal" value={ov[k] ?? ""} onChange={(e) => setOv({ ...ov, [k]: e.target.value })} /></div>
            ))}
            <div><label className="label">Overhead method</label>
              <select className="input" value={ov.overhead_method ?? ""} onChange={(e) => setOv({ ...ov, overhead_method: e.target.value })}>
                <option value="">Company default</option>
                <option value="equal">Equal per vehicle</option><option value="by_km">By KM / utilization</option>
                <option value="by_revenue">By revenue</option><option value="by_active_days">By active days</option>
                <option value="manual">Manual</option>
              </select></div>
            <p className="col-span-full text-xs text-amber-700">⚠ Every value here overrides the ERP's own historical figure for this calculation only — nothing stored is changed.</p>
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button onClick={calculate} disabled={busy} className="btn">{busy ? "Calculating…" : "Calculate"}</button>
      </div>

      {result && (
        <>
          <div className="card flex flex-wrap items-center gap-6">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Estimated Trip Cost</div>
              <div className="text-3xl font-bold text-slate-800">{sar(result.trip_cost)}</div>
              <div className="text-sm text-slate-500">Cost / KM: {cpk(result.cost_per_km)} · {km2(result.km?.total_km)} total{result.km?.extra_return_km > 0 ? ` (incl. ${km2(result.km.extra_return_km)} expected empty return)` : ""}</div>
            </div>
            <ConfidenceBadge c={result.confidence} />
            <span className="text-xs text-slate-400">Period: {PERIODS.find((p) => p[0] === period)?.[1]} ({dateStr(result.period?.from)} – {dateStr(result.period?.to)})</span>
          </div>

          <Warnings warnings={result.warnings ?? []} />

          <div><h3 className="mb-2 text-sm font-semibold text-slate-700">Cost Breakdown</h3><BreakdownTable components={result.components} /></div>

          <div className="card">
            <h3 className="mb-2 text-sm font-semibold text-slate-700">Pricing Intelligence <span className="font-normal text-slate-400">({result.pricing?.method === "markup" ? "markup on cost" : "margin on price"})</span></h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div><div className="text-xs text-slate-400">Cost Price</div><div className="text-lg font-semibold">{sar(result.pricing?.cost_price)}</div></div>
              <div><div className="text-xs text-slate-400">Minimum Sustainable ({pct(result.pricing?.min_margin_pct)})</div><div className="text-lg font-semibold">{sar(result.pricing?.min_price)}</div></div>
              <div><div className="text-xs text-slate-400">Recommended B2B ({pct(result.pricing?.recommended_margin_pct)})</div><div className="text-lg font-semibold text-brand">{sar(result.pricing?.recommended_price)}</div></div>
              <div><div className="text-xs text-slate-400">Target ({pct(result.pricing?.target_margin_pct)})</div><div className="text-lg font-semibold">{sar(result.pricing?.target_price)}</div></div>
            </div>
          </div>

          <div className="card">
            <h3 className="mb-2 text-sm font-semibold text-slate-700">Historical Performance</h3>
            {result.historical_sales?.trips > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div><div className="text-xs text-slate-400">Trips</div><div className="font-semibold">{result.historical_sales.trips}</div></div>
                <div><div className="text-xs text-slate-400">Lowest / Highest</div><div className="font-semibold">{sar(result.historical_sales.lowest)} / {sar(result.historical_sales.highest)}</div></div>
                <div><div className="text-xs text-slate-400">Average / Median</div><div className="font-semibold">{sar(result.historical_sales.average)} / {sar(result.historical_sales.median)}</div></div>
                <div><div className="text-xs text-slate-400">Avg. Profit / Margin</div><div className="font-semibold">{sar(result.historical_sales.average_profit)} / {pct(result.historical_sales.average_margin_pct)}</div></div>
                <p className="col-span-full text-xs text-slate-400">Cost basis: reconstructed at today's cost/KM (the ERP keeps no historical cost/KM series).</p>
              </div>
            ) : <p className="text-sm text-slate-400">No completed trips for this vehicle + route in this period — nothing to compare against yet.</p>}
          </div>

          <div className="card space-y-3">
            <h3 className="text-sm font-semibold text-slate-700">Profit Simulator</h3>
            <div className="flex flex-wrap items-end gap-3">
              <div><label className="label">Selling Price</label>
                <input className="input" inputMode="decimal" value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} placeholder="0.00" /></div>
              <div className="flex gap-1">
                {[5, 10, 15, 20, 25, 30].map((m) => (
                  <button key={m} type="button" className="btn-outline text-xs"
                    onClick={() => setSellPrice(String(result?.pricing?.method === "markup" ? cost * (1 + m / 100) : cost / (1 - m / 100)))}>
                    +{m}%
                  </button>
                ))}
              </div>
            </div>
            {sellPrice && (
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div><div className="text-xs text-slate-400">Revenue</div><div className="font-semibold">{sar(revenue)}</div></div>
                <div><div className="text-xs text-slate-400">Estimated Profit</div><div className={`font-semibold ${profit >= 0 ? "text-emerald-700" : "text-red-700"}`}>{sar(profit)}</div></div>
                <div><div className="text-xs text-slate-400">Profit Margin</div><div className="font-semibold">{margin === null ? "—" : pct(margin)}</div></div>
              </div>
            )}
            <Warnings warnings={simWarnings} />
          </div>

          <div className="flex items-center gap-3">
            <button onClick={saveSnapshot} disabled={busy} className="btn-outline">Save Costing Snapshot</button>
            {savedMsg && <span className="text-sm text-emerald-700">{savedMsg}</span>}
          </div>
        </>
      )}
    </div>
  );
}

// ── Mode 2: Route Comparison ─────────────────────────────────────────────
function CompareTab({ routes, period, setPeriod, from, setFrom, to, setTo, supabase }: any) {
  const [routeId, setRouteId] = useState<string>(routes[0]?.id ?? "");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [data, setData] = useState<any>(null);
  async function run() {
    if (!routeId) return;
    setBusy(true); setError(null);
    const { data: d, error: err } = await supabase.rpc("transport_costing_route_compare", {
      p_company: COMPANY_ID, p_route_id: routeId, p_period: period,
      p_period_from: period === "custom" ? from : null, p_period_to: period === "custom" ? to : null,
    });
    setBusy(false); if (err) return setError(err.message); setData(d);
  }
  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem]"><label className="label">Route</label>
          <SearchSelect value={routeId} onChange={setRouteId} placeholder="Choose a route…" options={routes.map((r: Route) => ({ value: r.id, label: r.name }))} /></div>
        <PeriodPicker period={period} setPeriod={setPeriod} from={from} setFrom={setFrom} to={to} setTo={setTo} />
        <button onClick={run} disabled={busy} className="btn">{busy ? "…" : "Compare"}</button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
      {data && (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr><th className="th">Vehicle</th><th className="th">Driver</th><th className="th text-right">Cost / KM</th><th className="th text-right">Trip Cost ({km2(data.route?.distance_km)})</th><th className="th text-right">Monthly KM</th><th className="th">Confidence</th></tr></thead>
            <tbody>
              {(data.vehicles ?? []).map((v: any, i: number) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="td font-medium">{v.vehicle?.name}</td>
                  <td className="td">{v.vehicle?.driver_name ?? "—"}</td>
                  <td className="td text-right tabular-nums">{cpk(v.cost_per_km)}</td>
                  <td className="td text-right tabular-nums font-semibold">{sar(v.trip_cost)}</td>
                  <td className="td text-right tabular-nums">{km2(v.monthly_km)}</td>
                  <td className="td"><ConfidenceBadge c={v.confidence} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Mode 3: Vehicle Performance ──────────────────────────────────────────
function VehiclePerfTab({ vehicles, period, setPeriod, from, setFrom, to, setTo, supabase }: any) {
  const [vehicleId, setVehicleId] = useState<string>(vehicles[0]?.id ?? "");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [d, setD] = useState<any>(null);
  async function run() {
    if (!vehicleId) return;
    setBusy(true); setError(null);
    const { data, error: err } = await supabase.rpc("transport_costing_vehicle_performance", {
      p_company: COMPANY_ID, p_vehicle_id: vehicleId, p_period: period,
      p_period_from: period === "custom" ? from : null, p_period_to: period === "custom" ? to : null,
    });
    setBusy(false); if (err) return setError(err.message); setD(data);
  }
  const tile = (label: string, value: string, tone?: string) => (
    <div className="card"><div className="text-xs text-slate-400">{label}</div><div className={`text-xl font-bold ${tone ?? "text-slate-800"}`}>{value}</div></div>
  );
  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem]"><label className="label">Vehicle</label>
          <SearchSelect value={vehicleId} onChange={setVehicleId} placeholder="Choose a vehicle…" options={vehicles.map((v: Vehicle) => ({ value: v.id, label: v.name }))} /></div>
        <PeriodPicker period={period} setPeriod={setPeriod} from={from} setFrom={setFrom} to={to} setTo={setTo} />
        <button onClick={run} disabled={busy} className="btn">{busy ? "…" : "Run"}</button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
      {d && (
        <>
          <div className="flex items-center gap-3"><h3 className="font-semibold text-slate-700">{d.vehicle?.name}{d.vehicle?.driver_name ? ` — driver ${d.vehicle.driver_name}` : ""}</h3><ConfidenceBadge c={d.confidence} /></div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {tile("Total KM", km2(d.total_km))}
            {tile("Trips", String(d.trips))}
            {tile("Revenue", sar(d.revenue))}
            {tile("Expenses", sar(d.expenses))}
            {tile("Cost / KM", cpk(d.cost_per_km))}
            {tile("Revenue / KM", cpk(d.revenue_per_km))}
            {tile("Profit", sar(d.profit), Number(d.profit) >= 0 ? "text-emerald-700" : "text-red-700")}
            {tile("Profit / KM", cpk(d.profit_per_km), Number(d.profit) >= 0 ? "text-emerald-700" : "text-red-700")}
            {tile("Utilization (KM)", km2(d.utilization_km))}
            {tile("Active Days", String(d.active_days))}
            {tile("Empty Return %", pct(d.empty_return_pct))}
            {tile("Average Trip Value", sar(d.average_trip_value))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Mode 4: Route Profitability ──────────────────────────────────────────
function RouteProfitTab({ routes, period, setPeriod, from, setFrom, to, setTo, supabase }: any) {
  const [routeId, setRouteId] = useState<string>(routes[0]?.id ?? "");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [d, setD] = useState<any>(null);
  async function run() {
    if (!routeId) return;
    setBusy(true); setError(null);
    const { data, error: err } = await supabase.rpc("transport_costing_route_profitability", {
      p_company: COMPANY_ID, p_route_id: routeId, p_period: period,
      p_period_from: period === "custom" ? from : null, p_period_to: period === "custom" ? to : null,
    });
    setBusy(false); if (err) return setError(err.message); setD(data);
  }
  const tile = (label: string, value: string, tone?: string) => (
    <div className="card"><div className="text-xs text-slate-400">{label}</div><div className={`text-xl font-bold ${tone ?? "text-slate-800"}`}>{value}</div></div>
  );
  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem]"><label className="label">Route</label>
          <SearchSelect value={routeId} onChange={setRouteId} placeholder="Choose a route…" options={routes.map((r: Route) => ({ value: r.id, label: r.name }))} /></div>
        <PeriodPicker period={period} setPeriod={setPeriod} from={from} setFrom={setFrom} to={to} setTo={setTo} />
        <button onClick={run} disabled={busy} className="btn">{busy ? "…" : "Run"}</button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
      {d && (
        <>
          <h3 className="font-semibold text-slate-700">{d.route?.name} ({km2(d.route?.distance_km)})</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {tile("Trips", String(d.trips))}
            {tile("Total KM", km2(d.total_km))}
            {tile("Avg. Selling Price", sar(d.average_selling_price))}
            {tile("Avg. Cost", sar(d.average_cost))}
            {tile("Avg. Profit", sar(d.average_profit), Number(d.average_profit) >= 0 ? "text-emerald-700" : "text-red-700")}
            {tile("Avg. Margin", pct(d.average_margin_pct))}
            {tile("Empty Return %", pct(d.empty_return_pct))}
            {tile("Revenue / KM", cpk(d.revenue_per_km))}
            {tile("Cost / KM", cpk(d.cost_per_km))}
            {tile("Profit / KM", cpk(d.profit_per_km))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Mode 5: Fleet Overview ───────────────────────────────────────────────
function FleetTab({ period, setPeriod, from, setFrom, to, setTo, supabase }: any) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [d, setD] = useState<any>(null);
  async function run() {
    setBusy(true); setError(null);
    const { data, error: err } = await supabase.rpc("transport_costing_fleet_overview", {
      p_company: COMPANY_ID, p_period: period, p_period_from: period === "custom" ? from : null, p_period_to: period === "custom" ? to : null,
    });
    setBusy(false); if (err) return setError(err.message); setD(data);
  }
  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-end gap-3">
        <PeriodPicker period={period} setPeriod={setPeriod} from={from} setFrom={setFrom} to={to} setTo={setTo} />
        <button onClick={run} disabled={busy} className="btn">{busy ? "…" : "Run"}</button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
      {d && (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr>
              <th className="th">Vehicle</th><th className="th text-right">KM</th><th className="th text-right">Revenue</th>
              <th className="th text-right">Expense</th><th className="th text-right">Cost/KM</th><th className="th text-right">Revenue/KM</th>
              <th className="th text-right">Profit</th><th className="th text-right">Margin</th>
            </tr></thead>
            <tbody>
              {(d.vehicles ?? []).map((v: any, i: number) => {
                const margin = Number(v.revenue) > 0 ? (100 * Number(v.profit)) / Number(v.revenue) : null;
                return (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="td font-medium">{v.vehicle?.name}</td>
                    <td className="td text-right tabular-nums">{km2(v.total_km)}</td>
                    <td className="td text-right tabular-nums">{sar(v.revenue)}</td>
                    <td className="td text-right tabular-nums">{sar(v.expenses)}</td>
                    <td className="td text-right tabular-nums">{cpk(v.cost_per_km)}</td>
                    <td className="td text-right tabular-nums">{cpk(v.revenue_per_km)}</td>
                    <td className={`td text-right tabular-nums font-semibold ${Number(v.profit) >= 0 ? "text-emerald-700" : "text-red-700"}`}>{sar(v.profit)}</td>
                    <td className="td text-right tabular-nums">{margin === null ? "—" : pct(margin)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────
function DashboardTab({ period, setPeriod, from, setFrom, to, setTo, supabase }: any) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [d, setD] = useState<any>(null);
  async function run() {
    setBusy(true); setError(null);
    const { data, error: err } = await supabase.rpc("transport_costing_dashboard", {
      p_company: COMPANY_ID, p_period: period, p_period_from: period === "custom" ? from : null, p_period_to: period === "custom" ? to : null,
    });
    setBusy(false); if (err) return setError(err.message); setD(data);
  }
  useEffect(() => { run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const tile = (label: string, value: string, tone?: string) => (
    <div className="card"><div className="text-xs text-slate-400">{label}</div><div className={`text-xl font-bold ${tone ?? "text-slate-800"}`}>{value}</div></div>
  );
  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-end gap-3">
        <PeriodPicker period={period} setPeriod={setPeriod} from={from} setFrom={setFrom} to={to} setTo={setTo} />
        <button onClick={run} disabled={busy} className="btn">{busy ? "…" : "Refresh"}</button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
      {d && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tile("Fleet Cost / KM", cpk(d.fleet_cost_per_km))}
          {tile("Fleet Revenue / KM", cpk(d.fleet_revenue_per_km))}
          {tile("Fleet Profit / KM", cpk(d.fleet_profit_per_km), Number(d.fleet_profit_per_km) >= 0 ? "text-emerald-700" : "text-red-700")}
          {tile("Fleet Vehicles", String(d.fleet_vehicles))}
          {tile("Fleet Monthly Revenue", sar(d.fleet_monthly_revenue))}
          {tile("Fleet Monthly Expense", sar(d.fleet_monthly_expense))}
          {tile("Fleet Monthly Profit", sar(d.fleet_monthly_profit), Number(d.fleet_monthly_profit) >= 0 ? "text-emerald-700" : "text-red-700")}
          {tile("Avg. Vehicle Utilization", km2(d.average_vehicle_utilization_km))}
          {tile("Avg. Empty Return %", pct(d.average_empty_return_pct))}
          {tile("Most Profitable Route", d.most_profitable_route ? `${d.most_profitable_route.route} (${pct(d.most_profitable_route.margin_pct)})` : "—", "text-emerald-700")}
          {tile("Least Profitable Route", d.least_profitable_route ? `${d.least_profitable_route.route} (${pct(d.least_profitable_route.margin_pct)})` : "—", "text-red-700")}
        </div>
      )}
    </div>
  );
}

// ── Snapshots ─────────────────────────────────────────────────────────────
function SnapshotsTab({ supabase }: any) {
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("transport_costing_snapshots")
        .select("id, label, created_at, period_label, period_from, period_to, selling_price, result")
        .order("created_at", { ascending: false }).limit(200);
      setRows(data ?? []);
    })();
  }, [supabase]);
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead className="bg-slate-50"><tr><th className="th">Saved</th><th className="th">Label</th><th className="th">Period</th><th className="th text-right">Trip Cost</th><th className="th text-right">Selling Price</th><th className="th"></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <Fragment key={r.id}>
              <tr className="border-t border-slate-100">
                <td className="td">{dateStr(r.created_at)}</td>
                <td className="td">{r.label}</td>
                <td className="td">{r.period_label} ({dateStr(r.period_from)} – {dateStr(r.period_to)})</td>
                <td className="td text-right tabular-nums">{sar(r.result?.trip_cost)}</td>
                <td className="td text-right tabular-nums">{r.selling_price ? sar(r.selling_price) : "—"}</td>
                <td className="td"><button onClick={() => setOpen(open === r.id ? null : r.id)} className="text-sm text-brand hover:underline">{open === r.id ? "Hide" : "View"}</button></td>
              </tr>
              {open === r.id && (
                <tr className="border-t border-slate-100 bg-slate-50">
                  <td className="td" colSpan={6}><BreakdownTable components={r.result?.components ?? []} /></td>
                </tr>
              )}
            </Fragment>
          ))}
          {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={6}>No snapshots saved yet — use "Save Costing Snapshot" on the Calculator tab.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// ── Vehicle Cost Profiles ────────────────────────────────────────────────
function ProfilesTab({ vehicles, supabase }: { vehicles: Vehicle[]; supabase: any }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">
        These figures power the depreciation and tyre/oil lifecycle lines in the cost breakdown. They live only here —
        the Vehicles master screen is unchanged. Leave a field blank to fall back to actual historical expense data
        where it exists.
      </p>
      {vehicles.map((v) => <ProfileRow key={v.id} v={v} open={open === v.id} onToggle={() => setOpen(open === v.id ? null : v.id)} supabase={supabase} />)}
    </div>
  );
}
function ProfileRow({ v, open, onToggle, supabase }: { v: Vehicle; open: boolean; onToggle: () => void; supabase: any }) {
  const [f, setF] = useState({
    purchase_price: v.purchase_price ?? "", purchase_date: v.purchase_date ?? "", model_year: v.model_year ?? "",
    expected_life_km: v.expected_life_km ?? "", expected_life_years: v.expected_life_years ?? "", expected_resale_value: v.expected_resale_value ?? "",
    depreciation_enabled: v.depreciation_enabled, tyre_cost: v.tyre_cost ?? "", tyre_life_km: v.tyre_life_km ?? "",
    oil_change_cost: v.oil_change_cost ?? "", oil_change_interval_km: v.oil_change_interval_km ?? "", overhead_manual_monthly: v.overhead_manual_monthly ?? "",
  });
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  async function save() {
    setBusy(true); setMsg(null);
    const n = (x: any) => (x === "" || x === null || x === undefined ? null : Number(x));
    const { error } = await supabase.rpc("transport_vehicle_cost_profile_save", {
      p_vehicle_id: v.id, p_purchase_price: n(f.purchase_price), p_purchase_date: f.purchase_date || null,
      p_model_year: n(f.model_year), p_expected_life_km: n(f.expected_life_km), p_expected_life_years: n(f.expected_life_years),
      p_expected_resale_value: n(f.expected_resale_value), p_depreciation_enabled: f.depreciation_enabled,
      p_tyre_cost: n(f.tyre_cost), p_tyre_life_km: n(f.tyre_life_km), p_oil_change_cost: n(f.oil_change_cost),
      p_oil_change_interval_km: n(f.oil_change_interval_km), p_overhead_manual_monthly: n(f.overhead_manual_monthly),
    });
    setBusy(false);
    if (error) return setMsg(error.message);
    setMsg("Saved.");
  }
  const field = (k: keyof typeof f, label: string, type = "text") => (
    <div><label className="label">{label}</label>
      <input className="input" type={type} value={f[k] as any} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>
  );
  return (
    <div className="card">
      <button onClick={onToggle} className="flex w-full items-center justify-between text-left">
        <span className="font-medium text-slate-700">{v.name}{v.category ? ` — ${v.category}` : ""}</span>
        <span className="text-sm text-slate-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {field("purchase_price", "Purchase Price (SAR)")}
            {field("purchase_date", "Purchase Date", "date")}
            {field("model_year", "Model Year")}
            {field("expected_resale_value", "Expected Resale Value (SAR)")}
            {field("expected_life_km", "Expected Life (KM) — recommended")}
            {field("expected_life_years", "Expected Life (years) — used only if KM is blank")}
            {field("tyre_cost", "Tyre Set Cost (SAR)")}
            {field("tyre_life_km", "Tyre Life (KM)")}
            {field("oil_change_cost", "Oil Change Cost (SAR)")}
            {field("oil_change_interval_km", "Oil Change Interval (KM)")}
            {field("overhead_manual_monthly", "Manual Overhead Share/mo — used only when the company's allocation method is Manual")}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.depreciation_enabled} onChange={(e) => setF({ ...f, depreciation_enabled: e.target.checked })} />
            Include depreciation in this vehicle's cost
          </label>
          <div className="flex items-center gap-3">
            <button onClick={save} disabled={busy} className="btn">{busy ? "Saving…" : "Save"}</button>
            {msg && <span className={`text-sm ${msg === "Saved." ? "text-emerald-700" : "text-red-600"}`}>{msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
