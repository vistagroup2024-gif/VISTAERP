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
}

export interface Consumption {
  id: string;
  brn_id: string;
  reference: string | null;
  check_in: string;
  check_out: string;
  beds: number;
}

// Inclusive list of occupied nights: check_in .. check_out-1
export function nightsBetween(checkIn: string, checkOut: string): string[] {
  const out: string[] = [];
  const start = new Date(checkIn + "T00:00:00");
  const end = new Date(checkOut + "T00:00:00");
  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
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
  return new Date(day + "T00:00:00").toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  });
}
