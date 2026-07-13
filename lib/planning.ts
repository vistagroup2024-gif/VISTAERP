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

export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysUTC(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
