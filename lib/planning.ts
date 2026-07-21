// ============================================================
// BRN procurement planning engine (bulk, cross-group).
// Analyses ALL pending groups together against inventory and recommends the
// fewest new BRNs (bed capacity + date range) to cover aggregate demand.
// Pure functions so the dashboard and the simulator share identical maths.
// ============================================================

import { Brn, Consumption, nightsBetween, usedOnNight } from "./brn";

export interface PendGroup {
  id: string; group_no: string; pax: number; arrival_date: string; departure_date: string;
}

export interface DayDemand {
  date: string;
  arrivals: number;      // groups arriving this day
  staying: number;       // groups occupying this night
  required: number;      // total beds needed this night
  available: number;     // total inventory beds free this night
  shortage: number;      // max(0, required - available)
  maxGroupPax: number;   // largest single group occupying this night
}

export interface BrnRecommendation {
  beds: number; from: string; to: string; nights: number;
}

// Build the per-day demand curve over the given period days.
export function buildDemand(
  days: string[], groups: PendGroup[], brns: Brn[], consByBrn: Record<string, Consumption[]>
): DayDemand[] {
  return days.map((d) => {
    const occ = groups.filter((g) => g.arrival_date <= d && g.departure_date > d);
    const required = occ.reduce((s, g) => s + g.pax, 0);
    let available = 0;
    for (const b of brns) {
      if (b.check_in <= d && b.check_out > d) available += b.beds - usedOnNight(d, consByBrn[b.id] ?? []);
    }
    return {
      date: d,
      arrivals: groups.filter((g) => g.arrival_date === d).length,
      staying: occ.length,
      required,
      available,
      shortage: Math.max(0, required - available),
      maxGroupPax: occ.reduce((m, g) => Math.max(m, g.pax), 0),
    };
  });
}

// A unit of demand: a group (or a partial package) that needs `pax` beds on a
// specific set of nights (full stay for new groups; only the uncovered nights
// for pending package updates).
export interface DemandItem { id: string; pax: number; nights: Set<string>; arrival?: string }

export function buildDemandFromItems(
  days: string[], items: DemandItem[], brns: Brn[], consByBrn: Record<string, Consumption[]>
): DayDemand[] {
  return days.map((d) => {
    const here = items.filter((it) => it.nights.has(d));
    const required = here.reduce((s, it) => s + it.pax, 0);
    let available = 0;
    for (const b of brns) {
      if (b.check_in <= d && b.check_out > d) available += b.beds - usedOnNight(d, consByBrn[b.id] ?? []);
    }
    return {
      date: d,
      arrivals: items.filter((it) => it.arrival === d).length,
      staying: here.length,
      required,
      available,
      shortage: Math.max(0, required - available),
      maxGroupPax: here.reduce((m, it) => Math.max(m, it.pax), 0),
    };
  });
}

// Recommend the minimum number of new BRNs to cover the shortage.
// Each contiguous shortage run becomes ONE BRN, sized to that run's peak
// aggregate shortage but never smaller than the largest single group in the
// run (so every group fits a single BRN per the one-BRN-per-night rule).
export function recommendBrns(demand: DayDemand[]): BrnRecommendation[] {
  const work = demand.map((d) => d.shortage);
  const recs: BrnRecommendation[] = [];
  let guard = 0;
  while (guard++ < 500) {
    const i = work.findIndex((v) => v > 0);
    if (i < 0) break;
    let j = i;
    while (j + 1 < work.length && work[j + 1] > 0) j++;
    let peak = 0, maxPax = 0;
    for (let k = i; k <= j; k++) { peak = Math.max(peak, work[k]); maxPax = Math.max(maxPax, demand[k].maxGroupPax); }
    const beds = Math.max(peak, maxPax);
    for (let k = i; k <= j; k++) work[k] = Math.max(0, work[k] - beds);
    // to = day after the last shortage day (checkout convention)
    const lastDay = demand[j].date;
    const to = new Date(lastDay + "T00:00:00Z");
    to.setUTCDate(to.getUTCDate() + 1);
    recs.push({ beds, from: demand[i].date, to: to.toISOString().slice(0, 10), nights: j - i + 1 });
  }
  return recs;
}

// Simulate adding a hypothetical BRN: returns the new shortage curve + metrics.
export function simulate(
  demand: DayDemand[], addBeds: number, from: string, to: string
) {
  const nights = new Set(nightsBetween(from, to));
  let coveredBefore = 0, coveredAfter = 0, unused = 0;
  const after = demand.map((d) => {
    const active = nights.has(d.date);
    const newAvailable = d.available + (active ? addBeds : 0);
    const newShortage = Math.max(0, d.required - newAvailable);
    coveredBefore += Math.min(d.required, d.available);
    coveredAfter += Math.min(d.required, newAvailable);
    if (active) unused += Math.max(0, newAvailable - d.required);
    return { date: d.date, shortage: newShortage };
  });
  const remainingShortage = after.reduce((s, x) => s + x.shortage, 0);
  const shortageBefore = demand.reduce((s, d) => s + d.shortage, 0);
  return {
    remainingShortage,
    shortageBefore,
    reduced: shortageBefore - remainingShortage,
    extraCovered: coveredAfter - coveredBefore,
    unusedBeds: unused,
  };
}

// City-wise planning with intelligent Madinah concentration.
// Each item needs exactly ONE Madinah night (any night in its stay); the rest
// are Makkah. We greedily concentrate Madinah nights on the dates shared by the
// most demand (by beds) to minimise the number of Madinah BRNs to buy.
export interface CityPlan {
  makkah: { demand: DayDemand[]; recs: BrnRecommendation[] };
  madinah: { demand: DayDemand[]; recs: BrnRecommendation[]; assignments: { date: string; beds: number; groups: number }[] };
}

export function planByCity(items: DemandItem[], brns: Brn[], consByBrn: Record<string, Consumption[]>): CityPlan {
  const makBrns = brns.filter((b) => b.city === "Makkah");
  const madBrns = brns.filter((b) => b.city === "Madinah");

  // 1. Assign each item's single Madinah night by concentration (most beds shared)
  const madAssign = new Map<string, string>();
  let pool = items.filter((it) => it.nights.size > 0);
  const assignments: { date: string; beds: number; groups: number }[] = [];
  let guard = 0;
  while (pool.length && guard++ < 1000) {
    const freq = new Map<string, number>();
    pool.forEach((it) => Array.from(it.nights).forEach((n) => freq.set(n, (freq.get(n) ?? 0) + it.pax)));
    let best = "", bestv = -1;
    freq.forEach((v, d) => { if (v > bestv) { bestv = v; best = d; } });
    const chosen = pool.filter((it) => it.nights.has(best));
    let beds = 0;
    for (const it of chosen) { madAssign.set(it.id, best); beds += it.pax; }
    assignments.push({ date: best, beds, groups: chosen.length });
    pool = pool.filter((it) => !it.nights.has(best));
  }

  // 2. Build per-city demand-by-date
  const allNights = Array.from(new Set(items.flatMap((it) => Array.from(it.nights)))).sort();
  const days = allNights;

  const madReq: Record<string, number> = {}, madMax: Record<string, number> = {};
  const makReq: Record<string, number> = {}, makMax: Record<string, number> = {};
  for (const it of items) {
    const md = madAssign.get(it.id);
    if (md) { madReq[md] = (madReq[md] ?? 0) + it.pax; madMax[md] = Math.max(madMax[md] ?? 0, it.pax); }
    Array.from(it.nights).forEach((n) => {
      if (n === md) return;
      makReq[n] = (makReq[n] ?? 0) + it.pax; makMax[n] = Math.max(makMax[n] ?? 0, it.pax);
    });
  }

  const cityDemand = (reqByDate: Record<string, number>, maxByDate: Record<string, number>, cityBrns: Brn[]): DayDemand[] =>
    days.map((d) => {
      const required = reqByDate[d] ?? 0;
      let available = 0;
      for (const b of cityBrns) if (b.check_in <= d && b.check_out > d) available += b.beds - usedOnNight(d, consByBrn[b.id] ?? []);
      return { date: d, arrivals: 0, staying: 0, required, available, shortage: Math.max(0, required - available), maxGroupPax: maxByDate[d] ?? 0 };
    }).filter((x) => x.required > 0 || x.shortage > 0);

  const makDemand = cityDemand(makReq, makMax, makBrns);
  const madDemand = cityDemand(madReq, madMax, madBrns);
  return {
    makkah: { demand: makDemand, recs: recommendBrns(makDemand) },
    madinah: { demand: madDemand, recs: recommendBrns(madDemand), assignments: assignments.filter((a) => a.beds > 0).sort((a, b) => a.date.localeCompare(b.date)) },
  };
}

export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysUTC(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
