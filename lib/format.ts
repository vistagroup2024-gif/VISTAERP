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

// 12-hour time for drivers/customers who don't read 24h clocks, e.g. "8:30am".
// Accepts "HH:MM", "HH:MM:SS", or an ISO/timestamp string. Returns "" when empty.
export function fmtTime12(t?: string | null): string {
  if (!t) return "";
  const s = String(t);
  let hh: number, mm: number;
  const m = /(\d{1,2}):(\d{2})/.exec(s.includes("T") ? s.split("T")[1] ?? "" : s);
  if (m) { hh = Number(m[1]); mm = Number(m[2]); }
  else {
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    hh = d.getHours(); mm = d.getMinutes();
  }
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return s;
  const ap = hh < 12 ? "am" : "pm";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, "0")}${ap}`;
}

export const COMPANY_ID = process.env.NEXT_PUBLIC_DEFAULT_COMPANY_ID!;
