// A shared Year + Months period, for the reports that genuinely analyse by
// calendar period (Sales, Cost Centre Costing — not an as-at balance report,
// which keeps its own single date). Selecting specific months (not
// necessarily a contiguous run — e.g. January and March, skipping February)
// is broken into the smallest number of contiguous date ranges, so the
// existing report RPCs (which each take one p_from/p_to) can be called
// as-is and their results merged — no new calculation, no RPC signature
// change for this.
import { yearSA } from "@/lib/saudiTime";

export const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface YearMonths { year: number; months: number[] } // months: 1-12, sorted, deduped

export function defaultYearMonths(): YearMonths {
  return { year: yearSA(), months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] };
}

function pad(n: number) { return String(n).padStart(2, "0"); }
function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The selected months, grouped into the fewest contiguous {from,to} ranges. */
export function monthRanges({ year, months }: YearMonths): { from: string; to: string }[] {
  const sorted = Array.from(new Set(months)).filter((m) => m >= 1 && m <= 12).sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const ranges: { from: string; to: string }[] = [];
  let runStart = sorted[0], runEnd = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const m = sorted[i];
    if (m === runEnd + 1) { runEnd = m; continue; }
    ranges.push({
      from: `${year}-${pad(runStart)}-01`,
      to: `${year}-${pad(runEnd)}-${pad(lastDayOfMonth(year, runEnd))}`,
    });
    if (m !== undefined) { runStart = m; runEnd = m; }
  }
  return ranges;
}

/** A short label for the current selection — "2026", "Jan-Mar 2026", "Jan, Mar 2026". */
export function periodLabel({ year, months }: YearMonths): string {
  const sorted = Array.from(new Set(months)).sort((a, b) => a - b);
  if (sorted.length === 0) return String(year);
  if (sorted.length === 12) return String(year);
  const ranges = monthRanges({ year, months: sorted });
  const parts = ranges.map((r) => {
    const [, fm] = r.from.split("-"); const [, tm] = r.to.split("-");
    return fm === tm ? MONTH_LABELS[Number(fm) - 1] : `${MONTH_LABELS[Number(fm) - 1]}-${MONTH_LABELS[Number(tm) - 1]}`;
  });
  return `${parts.join(", ")} ${year}`;
}
