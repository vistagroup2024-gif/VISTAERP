export function money(amount: number | null | undefined, currency = "PKR") {
  const n = Number(amount ?? 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Standard display format across the app: DD-MMM-YY, e.g. 04-Aug-26.
export function dateStr(d: string | null | undefined) {
  if (!d) return "—";
  // Force UTC for date-only strings so the displayed day never shifts by tz.
  const iso = d.length === 10 ? d + "T00:00:00Z" : d;
  const dt = new Date(iso);
  if (isNaN(dt.getTime())) return "—";
  const day = String(dt.getUTCDate()).padStart(2, "0");
  const yy = String(dt.getUTCFullYear()).slice(-2);
  return `${day}-${MONTHS[dt.getUTCMonth()]}-${yy}`;
}

export const COMPANY_ID = process.env.NEXT_PUBLIC_DEFAULT_COMPANY_ID!;
