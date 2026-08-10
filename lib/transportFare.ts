// Distribute a booking's discount across its trips as WHOLE SAR that sum exactly to
// the target (net + surcharge), instead of scaling every trip by the discount ratio
// (which yields fractions like 428.57). Largest-remainder rounding: floor each
// proportional share, then hand the leftover riyals to the biggest fractions.
//
// e.g. bases [500,500,400] (gross 1400), target 1200 → [429, 428, 343] (sums to 1200).
export function distributeWhole(bases: number[], target: number): number[] {
  const gross = bases.reduce((a, n) => a + n, 0);
  const tgt = Math.round(target);
  if (gross <= 0) return bases.map(() => 0);
  const shares = bases.map((n) => (n / gross) * tgt);
  const floors = shares.map((x) => Math.floor(x));
  const rem = tgt - floors.reduce((a, n) => a + n, 0);
  const order = shares
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((p, q) => q.frac - p.frac);
  for (let k = 0; k < rem && k < order.length; k++) floors[order[k].i] += 1;
  return floors;
}
