// A yearly target or budget figure typed once, divided into twelve monthly
// cells the same way any accounting split works: eleven equal months and a
// twelfth that absorbs the rounding remainder, so the twelve always sum back
// to exactly the figure typed — never eleven equal months and one drifting a
// cent short or long from a naive round-every-month approach. Every month
// stays independently hand-editable after the split; this only seeds them.
export function splitAnnual(amount: number): number[] {
  const base = Math.round((amount / 12) * 100) / 100;
  const out = Array(11).fill(base);
  const last = Math.round((amount - base * 11) * 100) / 100;
  out.push(last);
  return out;
}

export const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
