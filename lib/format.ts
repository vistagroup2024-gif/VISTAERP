export function money(amount: number | null | undefined, currency = "PKR") {
  const n = Number(amount ?? 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n);
}

export function dateStr(d: string | null | undefined) {
  if (!d) return "—";
  // Force UTC for date-only strings so the displayed day never shifts by tz.
  const iso = d.length === 10 ? d + "T00:00:00Z" : d;
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export const COMPANY_ID = process.env.NEXT_PUBLIC_DEFAULT_COMPANY_ID!;
