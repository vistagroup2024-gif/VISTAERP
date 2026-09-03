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
  maxGroupPax: number;   // largest single UNFITTABLE group this night (sizes the recommended BRN)
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
// Returns the pax of the groups that CANNOT be seated (best-fit-decreasing).
export function unfittablePaxList(groupPax: number[], caps: number[]): number[] {
  const bins = [...caps];
  const unseated: number[] = [];
  for (const pax of [...groupPax].sort((a, b) => b - a)) {
    let bi = -1, bcap = Infinity;
    for (let i = 0; i < bins.length; i++) {
      if (bins[i] >= pax && bins[i] < bcap) { bcap = bins[i]; bi = i; }
    }
    if (bi === -1) unseated.push(pax); else bins[bi] -= pax;
  }
  return unseated;
}

export function unfittablePax(groupPax: number[], caps: number[]): number {
  return unfittablePaxList(groupPax, caps).reduce((s, x) => s + x, 0);
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
      shortage: unfittablePaxList(occ.map((g) => g.pax), caps).reduce((s, x) => s + x, 0),
      maxGroupPax: unfittablePaxList(occ.map((g) => g.pax), caps).reduce((m, x) => Math.max(m, x), 0),
    };
  });
}

// A unit of demand: a group (or a partial package) that needs `pax` beds on a
// specific set of nights (full stay for new groups; only the uncovered nights
// for pending package updates).
// `hasMadinah` = the group's package ALREADY includes a Madinah night (an existing
// Madinah BRN is allocated to it). When true, none of its uncovered nights are
// carved out as Madinah — they are all Makkah demand (so the planner buys Makkah).
// When false, the group still needs one Madinah night: we place it on free Madinah
// inventory when possible, and only recommend buying Madinah as a last resort.
export interface DemandItem { id: string; pax: number; nights: Set<string>; arrival?: string; departure?: string; hasMadinah?: boolean }

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
      shortage: unfittablePaxList(here.map((it) => it.pax), caps).reduce((s, x) => s + x, 0),
      maxGroupPax: unfittablePaxList(here.map((it) => it.pax), caps).reduce((m, x) => Math.max(m, x), 0),
    };
  });
}

// Recommend the minimum number of new BRNs to cover the shortage.
// Each contiguous shortage run becomes ONE BRN, sized to that run's peak
// aggregate shortage but never smaller than the largest single UNFITTABLE group
// in the run (so that group fits the new BRN per the one-BRN-per-night rule).
// Crucially this is the largest group that could NOT already be seated in
// existing inventory — a big group that fits an existing BRN must not inflate
// the recommendation (that was the bug where a 10-pax group already covered by a
// 16-bed BRN forced a needless 10-bed purchase when only ~4 beds were short).
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
  while (guard++ < 2000) {
    const i = work.findIndex((v) => v > 0);
    if (i < 0) break;

    // The contiguous calendar run this shortage belongs to.
    let j = i;
    while (j + 1 < work.length && work[j + 1] > 0 && demand[j + 1].date === addDaysUTC(demand[j].date, 1)) j++;

    // Peel the TOP LAYER of the run, not the whole run at its peak.
    //
    // Sizing one BRN at the run's peak and stretching it over every night of
    // the run is what made a two-night spike of 43 beds turn into "43 beds,
    // 04 Oct → 04 Nov": a month of inventory bought for two nights' demand.
    //
    // `below` is the highest shortage in the run that is under the peak, so the
    // nights above it are exactly the ones needing more beds than the rest.
    // Those nights get this BRN; the layer they share with the rest of the run
    // stays behind and is covered by a longer, smaller BRN on the next pass.
    let peak = 0;
    for (let k = i; k <= j; k++) peak = Math.max(peak, work[k]);
    let below = 0;
    for (let k = i; k <= j; k++) if (work[k] < peak) below = Math.max(below, work[k]);

    // The first contiguous stretch of the run standing above `below`.
    let s = i;
    while (s <= j && work[s] <= below) s++;
    let e = s;
    while (e + 1 <= j && work[e + 1] > below && demand[e + 1].date === addDaysUTC(demand[e].date, 1)) e++;

    // Never smaller than the largest single group that could not already be
    // seated on those nights — a group must fit one BRN whole.
    //
    // maxGroupPax is the night's ORIGINAL largest unfittable group, so it has
    // to be clamped to what is still short: once the spike BRN above has taken
    // the big group, the small layer left behind must not be sized for it too.
    // The clamp is exact, not a guess — shortage is the SUM of the unseated
    // groups' pax, so the largest of them can never exceed it.
    let maxPax = 0;
    for (let k = s; k <= e; k++) maxPax = Math.max(maxPax, Math.min(demand[k].maxGroupPax, work[k]));
    const beds = Math.max(peak, maxPax);

    // Only the layer above `below` is satisfied here; peak - below is at least
    // 1 (or the whole run is level and the run clears in one go), so the loop
    // always makes progress.
    const layer = peak - below > 0 ? peak - below : peak;
    for (let k = s; k <= e; k++) work[k] = Math.max(0, work[k] - layer);

    // to = day after the last shortage day (checkout convention)
    const lastDay = demand[e].date;
    const to = new Date(lastDay + "T00:00:00Z");
    to.setUTCDate(to.getUTCDate() + 1);
    recs.push({ beds, from: demand[s].date, to: to.toISOString().slice(0, 10), nights: e - s + 1 });
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

  // Only groups whose package does NOT already include Madinah need a Madinah night
  // carved out. Groups that already have Madinah keep every uncovered night as Makkah
  // demand (planner buys Makkah for them); their `madAssign` stays empty below.
  const needMad = items.filter((it) => it.nights.size > 0 && !it.hasMadinah);

  const madAssign = new Map<string, string>();

  // Phase A — USE FREE MADINAH INVENTORY FIRST. Place each group's Madinah night on a
  // night of its stay where an existing Madinah BRN can seat the whole group in one
  // BRN. We consume from mutable per-night capacity bins so two groups can't be placed
  // beyond a BRN's free beds. This is the core rule: if Madinah is available and the
  // package lacks it, use Madinah rather than pushing the night onto Makkah to buy.
  const madBins: Record<string, number[]> = {};
  const binsOn = (d: string) => (madBins[d] ??= brnFreeCaps(d, madBrns, consByBrn));
  const placedFree = new Set<string>();
  // Largest groups first — they are the hardest to fit into a single BRN.
  for (const it of [...needMad].sort((a, b) => b.pax - a.pax)) {
    let cd = "", ci = -1, ccap = Infinity;
    for (const n of Array.from(it.nights)) {
      const bins = binsOn(n);
      for (let i = 0; i < bins.length; i++) {
        if (bins[i] >= it.pax && bins[i] < ccap) { ccap = bins[i]; ci = i; cd = n; }
      }
    }
    if (ci >= 0) { binsOn(cd)[ci] -= it.pax; madAssign.set(it.id, cd); placedFree.add(it.id); }
  }

  // Phase B — groups with no free Madinah bed anywhere in their stay still need a
  // Madinah night (to buy). Concentrate those on shared dates to minimise the number
  // of new Madinah BRNs, exactly as before.
  let pool = needMad.filter((it) => !placedFree.has(it.id));
  let guard = 0;
  while (pool.length && guard++ < 1000) {
    const freq = new Map<string, number>();
    pool.forEach((it) => Array.from(it.nights).forEach((n) => freq.set(n, (freq.get(n) ?? 0) + it.pax)));
    let best = "", bestv = -1;
    freq.forEach((v, d) => { if (v > bestv) { bestv = v; best = d; } });
    const chosen = pool.filter((it) => it.nights.has(best));
    for (const it of chosen) madAssign.set(it.id, best);
    pool = pool.filter((it) => !it.nights.has(best));
  }

  // Summary of where Madinah nights landed (for the UI note).
  const byDate = new Map<string, { beds: number; groups: number }>();
  for (const it of needMad) {
    const d = madAssign.get(it.id);
    if (!d) continue;
    const cur = byDate.get(d) ?? { beds: 0, groups: 0 };
    cur.beds += it.pax; cur.groups += 1; byDate.set(d, cur);
  }
  const assignments: { date: string; beds: number; groups: number }[] =
    Array.from(byDate.entries()).map(([date, v]) => ({ date, beds: v.beds, groups: v.groups }));

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
        shortage: unfittablePaxList(pax, caps).reduce((s, x) => s + x, 0),
        maxGroupPax: unfittablePaxList(pax, caps).reduce((m, x) => Math.max(m, x), 0) };
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
