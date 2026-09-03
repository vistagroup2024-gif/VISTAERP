// Helpers for the Hotel BRN Inventory module.
// Daily inventory is computed here from raw BRN + consumption rows so pages
// can render matrices without one RPC per BRN.

export interface Brn {
  id: string;
  hotel_name: string;
  brn: string;
  city: string | null;
  check_in: string;   // yyyy-mm-dd
  check_out: string;  // yyyy-mm-dd (checkout day, not occupied)
  beds: number;
  remarks: string | null;
  rate_per_bed?: number | null;
  group_company_id?: string | null;
}

// A BRN is fully consumed (archived) when NO night has any bed left to sell.
export function isArchived(brn: Brn, cons: Consumption[]): boolean {
  const daily = dailyForBrn(brn, cons);
  if (!daily.length) return false;
  return daily.every((d) => d.available <= 0);
}

// Highest number of beds still sellable on any single night. Useful for "is
// there anything left at all" (the archive test, the calendar filter) and
// nothing else: a BRN with one free night reads the same as a wide-open one.
export function maxNightlyAvailable(brn: Brn, cons: Consumption[]): number {
  const daily = dailyForBrn(brn, cons);
  return daily.reduce((m, d) => Math.max(m, d.available), 0);
}

export interface SellableRun {
  beds: number;      // free on every night of the run
  nights: number;    // how long the run is
  from: string | null;
  to: string | null; // checkout day of the run (not occupied)
}

/**
 * What this BRN can actually be sold for: the MOST beds that are free on a run
 * of consecutive nights, and which nights those are.
 *
 * A single "available" number cannot answer that, and reading it as though it
 * could is how a BRN with 12 beds free before a group arrives looks like 12
 * beds a group arriving later can use. The run's dates are what make the
 * difference visible on the row.
 *
 * Bed counts are tried from the highest down, so the answer is the biggest
 * block on offer; `minNights` (the 3-night minimum the allocator works to)
 * decides when a run is long enough to count, and if nothing reaches it the
 * best short run is returned instead.
 */
export function sellableRun(brn: Brn, cons: Consumption[], minNights = 3): SellableRun {
  const daily = dailyForBrn(brn, cons);
  const none: SellableRun = { beds: 0, nights: 0, from: null, to: null };
  if (!daily.length) return none;

  const levels = Array.from(new Set(daily.map((d) => d.available)))
    .filter((b) => b > 0)
    .sort((a, b) => b - a);

  let fallback = none;
  for (const beds of levels) {
    let bestLen = 0, bestStart = -1, cur = 0, curStart = -1;
    daily.forEach((d, i) => {
      if (d.available >= beds) {
        if (cur === 0) curStart = i;
        cur += 1;
        if (cur > bestLen) { bestLen = cur; bestStart = curStart; }
      } else cur = 0;
    });
    if (bestLen === 0) continue;
    const run: SellableRun = {
      beds, nights: bestLen,
      from: daily[bestStart].day,
      to: addDays(daily[bestStart + bestLen - 1].day, 1),
    };
    if (bestLen >= minNights) return run;
    if (run.beds * run.nights > fallback.beds * fallback.nights) fallback = run;
  }
  return fallback;
}

function addDays(day: string, n: number): string {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export interface Consumption {
  id: string;
  brn_id: string;
  reference: string | null;
  check_in: string;
  check_out: string;
  beds: number;
  created_at?: string;
}

// Occupied nights: check_in .. check_out-1 (checkout day is NEVER occupied).
// All arithmetic is done in UTC so the result never shifts by a day
// regardless of the server/runtime timezone.
export function nightsBetween(checkIn: string, checkOut: string): string[] {
  const out: string[] = [];
  const start = new Date(checkIn + "T00:00:00Z");
  const end = new Date(checkOut + "T00:00:00Z");
  for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export function totalNights(checkIn: string, checkOut: string): number {
  return nightsBetween(checkIn, checkOut).length;
}

// used beds on a given night for a BRN, given its consumption rows
export function usedOnNight(day: string, cons: Consumption[]): number {
  return cons.reduce(
    (sum, c) => (c.check_in <= day && c.check_out > day ? sum + c.beds : sum),
    0
  );
}

export interface DailyCell {
  day: string;
  capacity: number;
  used: number;
  available: number;
}

export function dailyForBrn(brn: Brn, cons: Consumption[]): DailyCell[] {
  const own = cons.filter((c) => c.brn_id === brn.id);
  return nightsBetween(brn.check_in, brn.check_out).map((day) => {
    const used = usedOnNight(day, own);
    return { day, capacity: brn.beds, used, available: brn.beds - used };
  });
}

// Total bed-nights (capacity) and consumed bed-nights across all BRNs.
export function totals(brns: Brn[], cons: Consumption[]) {
  let capacityNights = 0;
  let usedNights = 0;
  const consByBrn: Record<string, Consumption[]> = {};
  cons.forEach((c) => {
    (consByBrn[c.brn_id] ||= []).push(c);
  });
  for (const b of brns) {
    const daily = dailyForBrn(b, consByBrn[b.id] ?? []);
    capacityNights += daily.reduce((s, d) => s + d.capacity, 0);
    usedNights += daily.reduce((s, d) => s + d.used, 0);
  }
  return {
    capacityNights,
    usedNights,
    availableNights: capacityNights - usedNights,
    occupancyPct: capacityNights > 0 ? Math.round((usedNights / capacityNights) * 100) : 0,
  };
}

// Colour class for an availability cell, per spec conditional formatting.
export function cellClass(available: number, capacity: number): string {
  if (available < 0) return "bg-red-500 text-white font-semibold";       // overbooked
  if (available === 0) return "bg-orange-400 text-white";                // full
  const pct = capacity > 0 ? available / capacity : 1;
  if (pct <= 0.2) return "bg-yellow-200 text-yellow-900";                // low
  return "bg-green-100 text-green-800";                                  // healthy
}

export function fmtDay(day: string): string {
  return new Date(day + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
}
