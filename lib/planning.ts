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

// Free capacity of each BRN open on night `d` (only positive remaining beds).
function brnFreeCaps(d: string, brns: Brn[], consByBrn: Record<string, Consumption[]>): number[] {
  const caps: number[] = [];
  for (const b of brns) {
    if (b.check_in <= d && b.check_out > d) {
      const free = b.beds - usedOnNight(d, consByBrn[b.id] ?? []);
      if (free > 0) caps.push(free);
    }
  }
  return caps;
}

// One-BRN-per-group rule (mirrors DB sim_plan / migration 023): every group must
// be seated ENTIRELY in a single BRN with enough free beds that night — a group
// can never be split across two smaller BRNs. Aggregate free beds are therefore
// NOT the real measure of coverage: 14 free beds spread over 5+5+4 cannot seat a
// group of 10. Returns the pax that cannot be seated (best-fit-decreasing pack,
// choosing the smallest sufficient BRN like the DB allocator does).
export function unfittablePax(groupPax: number[], caps: number[]): number {
  const bins = [...caps];
  let short = 0;
  for (const pax of [...groupPax].sort((a, b) => b - a)) {
    let bi = -1, bcap = Infinity;
    for (let i = 0; i < bins.length; i++) {
      if (bins[i] >= pax && bins[i] < bcap) { bcap = bins[i]; bi = i; }
    }
    if (bi === -1) short += pax; else bins[bi] -= pax;
  }
  return short;
}

// Build the per-day demand curve over the given period days.
export function buildDemand(
  days: string[], groups: PendGroup[], brns: Brn[], consByBrn: Record<string, Consumption[]>
): DayDemand[] {
  return days.map((d) => {
    const occ = groups.filter((g) => g.arrival_date <= d && g.departure_date > d);
    const required = occ.reduce((s, g) => s + g.pax, 0);
    const caps = brnFreeCaps(d, brns, consByBrn);
    const available = caps.reduce((s, c) => s + c, 0);
    return {
      date: d,
      arrivals: groups.filter((g) => g.arrival_date === d).length,
      staying: occ.length,
      required,
      available,
      // Shortage respects the one-BRN-per-group rule, not the raw bed sum.
      shortage: unfittablePax(occ.map((g) => g.pax), caps),
      maxGroupPax: occ.reduce((m, g) => Math.max(m, g.pax), 0),
    };
  });
}

// A unit of demand: a group (or a partial package) that needs `pax` beds on a
// specific set of nights (full stay for new groups; only the uncovered nights
// for pending package updates).
export interface DemandItem { id: string; pax: number; nights: Set<string>; arrival?: string; departure?: string }

// Operational policy (mirrors nusuk_complete): a group may leave its very first
// night and/or its very last night uncovered when the main stay is covered.
// So the purchase planner must NOT recommend buying a boundary night that is
// missing on its own. We only drop a boundary night when it is an ISOLATED
// single-night gap (the adjacent night is already covered) — a multi-night
// boundary gap (e.g. a brand-new group whose entire stay is uncovered) is kept
// in full, because there the "main stay" is not yet covered.
//
// Example: arrival 29, departure 12, allocated 30→7.
//   uncovered = {29} ∪ {7,8,9,10,11}
//   front gap {29} is exactly the first night, adjacent (30) covered → dropped
//   back  gap {7..11} is multi-night → kept → recommend 7→12.
export function applyBoundaryTolerance(items: DemandItem[]): DemandItem[] {
  return items.map((it) => {
    if (!it.arrival || !it.departure) return it;
    const stay = nightsBetween(it.arrival, it.departure);
    if (stay.length < 2) return it;                 // single-night stay: nothing to tolerate
    const nights = new Set(it.nights);
    const first = stay[0], second = stay[1];
    const last = stay[stay.length - 1], prev = stay[stay.length - 2];
    if (nights.has(first) && !nights.has(second)) nights.delete(first);
    if (nights.has(last) && !nights.has(prev)) nights.delete(last);
    return { ...it, nights };
  });
}

export function buildDemandFromItems(
  days: string[], items: DemandItem[], brns: Brn[], consByBrn: Record<string, Consumption[]>
): DayDemand[] {
  return days.map((d) => {
    const here = items.filter((it) => it.nights.has(d));
    const required = here.reduce((s, it) => s + it.pax, 0);
    const caps = brnFreeCaps(d, brns, consByBrn);
    const available = caps.reduce((s, c) => s + c, 0);
    return {
      date: d,
      arrivals: items.filter((it) => it.arrival === d).length,
      staying: here.length,
      required,
      available,
      // One-BRN-per-group rule: a group only counts as covered if a single BRN
      // can seat all its pax — not merely if total free beds ≥ required.
      shortage: unfittablePax(here.map((it) => it.pax), caps),
      maxGroupPax: here.reduce((m, it) => Math.max(m, it.pax), 0),
    };
  });
}

// Recommend the minimum number of new BRNs to cover the shortage.
// Each contiguous shortage run becomes ONE BRN, sized to that run's peak
// aggregate shortage but never smaller than the largest single group in the
// run (so every group fits a single BRN per the one-BRN-per-night rule).
//
// A "contiguous run" means calendar-consecutive shortage nights. The demand
// array may be SPARSE (city-wise planning drops zero-demand dates), so two
// entries that are adjacent in the array can be weeks apart on the calendar.
// We must only merge nights that genuinely abut — otherwise a lone night on
// 09 Aug and another on 15 Sept would wrongly collapse into one long BRN
// carrying a month of unused inventory. Isolated demand → separate BRNs.
export function recommendBrns(demand: DayDemand[]): BrnRecommendation[] {
  const work = demand.map((d) => d.shortage);
  const recs: BrnRecommendation[] = [];
  let guard = 0;
  while (guard++ < 500) {
    const i = work.findIndex((v) => v > 0);
    if (i < 0) break;
    let j = i;
    while (j + 1 < work.length && work[j + 1] > 0 && demand[j + 1].date === addDaysUTC(demand[j].date, 1)) j++;
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
// The new BRN is a SINGLE unit of `addBeds`, so on active nights it can absorb
// the current shortage only up to `addBeds` (one BRN can't be split either), and
// only groups that individually fit within `addBeds` are helped. We approximate
// the extra coverage as min(shortage, addBeds) on active nights.
export function simulate(
  demand: DayDemand[], addBeds: number, from: string, to: string
) {
  const nights = new Set(nightsBetween(from, to));
  let coveredBefore = 0, coveredAfter = 0, unused = 0;
  const after = demand.map((d) => {
    const active = nights.has(d.date);
    const covBefore = d.required - d.shortage;                 // beds actually seatable now
    const extra = active ? Math.min(d.shortage, addBeds) : 0;  // one new BRN of addBeds
    const newShortage = Math.max(0, d.shortage - extra);
    coveredBefore += covBefore;
    coveredAfter += covBefore + extra;
    if (active) unused += Math.max(0, addBeds - d.shortage);
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

  // Track the individual group pax per date (not just the sum) so the shortage
  // can honour the one-BRN-per-group rule via bin packing.
  const madPax: Record<string, number[]> = {}, makPax: Record<string, number[]> = {};
  for (const it of items) {
    const md = madAssign.get(it.id);
    if (md) (madPax[md] ||= []).push(it.pax);
    Array.from(it.nights).forEach((n) => {
      if (n === md) return;
      (makPax[n] ||= []).push(it.pax);
    });
  }

  const cityDemand = (paxByDate: Record<string, number[]>, cityBrns: Brn[]): DayDemand[] =>
    days.map((d) => {
      const pax = paxByDate[d] ?? [];
      const required = pax.reduce((s, x) => s + x, 0);
      const caps = brnFreeCaps(d, cityBrns, consByBrn);
      const available = caps.reduce((s, c) => s + c, 0);
      return { date: d, arrivals: 0, staying: pax.length, required, available,
        shortage: unfittablePax(pax, caps), maxGroupPax: pax.reduce((m, x) => Math.max(m, x), 0) };
    }).filter((x) => x.required > 0 || x.shortage > 0);

  const makDemand = cityDemand(makPax, makBrns);
  const madDemand = cityDemand(madPax, madBrns);
  return {
    makkah: { demand: makDemand, recs: recommendBrns(makDemand) },
    madinah: { demand: madDemand, recs: recommendBrns(madDemand), assignments: assignments.filter((a) => a.beds > 0).sort((a, b) => a.date.localeCompare(b.date)) },
  };
}

// Combined daily diagnostic that stays CONSISTENT with the city recommendations.
// The naive combined curve (buildDemandFromItems over all BRNs) pools Makkah and
// Madinah beds together, so it can "seat" a Makkah group in a Madinah BRN and
// under-report the shortage — that is why the daily table used to say "No
// purchase" on a night the recommendation engine flagged. Here the shortage is
// the SUM of the per-city unfittable pax (a group can only use a BRN in its own
// city), so the table's Shortage/Purchase columns match planByCity's BRN advice.
// `available` is still the true total free beds both cities (a diagnostic figure).
export function combinedCityDemand(
  days: string[], items: DemandItem[], brns: Brn[],
  consByBrn: Record<string, Consumption[]>, cityPlan: CityPlan
): DayDemand[] {
  const mak = new Map(cityPlan.makkah.demand.map((r) => [r.date, r]));
  const mad = new Map(cityPlan.madinah.demand.map((r) => [r.date, r]));
  return days.map((d) => {
    const caps = brnFreeCaps(d, brns, consByBrn);
    const m = mak.get(d), n = mad.get(d);
    return {
      date: d,
      arrivals: items.filter((it) => it.arrival === d).length,
      staying: (m?.staying ?? 0) + (n?.staying ?? 0),
      required: (m?.required ?? 0) + (n?.required ?? 0),
      available: caps.reduce((s, c) => s + c, 0),
      shortage: (m?.shortage ?? 0) + (n?.shortage ?? 0),
      maxGroupPax: Math.max(m?.maxGroupPax ?? 0, n?.maxGroupPax ?? 0),
    };
  });
}

export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysUTC(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
