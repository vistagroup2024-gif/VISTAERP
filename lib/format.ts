import { SA_TZ } from "@/lib/saudiTime";

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
//
// Two kinds of value arrive here and they are not the same thing. A `date`
// column (or a naive timestamp) is a wall-clock date and is read literally —
// putting it through `new Date()` lets the browser's zone decide which day it
// is. A `timestamptz` is an instant, so it is shown as the day it was in Saudi
// Arabia, not the day it was in UTC or wherever the viewer happens to be.
const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})(?:[T ][\d:.]*)?$/;

const saYmd = new Intl.DateTimeFormat("en-CA", {
  timeZone: SA_TZ, year: "numeric", month: "2-digit", day: "2-digit",
});

export function dateStr(d: string | null | undefined) {
  if (!d) return "—";
  const s = String(d);
  let ymd = WALL_CLOCK.exec(s)?.[0].slice(0, 10);
  if (!ymd) {
    const dt = new Date(s);
    if (isNaN(dt.getTime())) return "—";
    ymd = saYmd.format(dt);                 // en-CA formats as YYYY-MM-DD
  }
  const day = ymd.slice(8, 10);
  const mon = MONTHS[Number(ymd.slice(5, 7)) - 1];
  if (!mon) return "—";
  return `${day}-${mon}-${ymd.slice(2, 4)}`;
}

// An instant with its clock time, both in Saudi time: "07-Sep-26 10:30pm".
// Use this rather than `new Date(x).toLocaleString()`, which renders in
// whatever zone the viewer's machine is set to.
export function dateTimeStr(d: string | null | undefined) {
  if (!d) return "—";
  const day = dateStr(d);
  const t = fmtTime12(d);
  return t && day !== "—" ? `${day} ${t}` : day;
}

// 12-hour time for drivers/customers who don't read 24h clocks, e.g. "8:30am".
// Accepts "HH:MM", "HH:MM:SS", or an ISO/timestamp string. Returns "" when empty.
// Same split as dateStr: a wall-clock value is read literally, an instant is
// shown in Saudi time rather than in whatever zone the browser is set to.
const saHm = new Intl.DateTimeFormat("en-GB", {
  timeZone: SA_TZ, hour: "2-digit", minute: "2-digit", hour12: false,
});

export function fmtTime12(t?: string | null): string {
  if (!t) return "";
  const s = String(t);
  let hh: number, mm: number;
  const wall = WALL_CLOCK.test(s) || !/[T ]/.test(s);
  const m = /(\d{1,2}):(\d{2})/.exec(s.includes("T") ? s.split("T")[1] ?? "" : s);
  if (wall) {
    // A bare date carries no time at all — don't invent midnight for it.
    if (!m) return WALL_CLOCK.test(s) ? "" : s;
    hh = Number(m[1]); mm = Number(m[2]);
  } else {
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    const [h, mi] = saHm.format(d).split(":");
    hh = Number(h); mm = Number(mi);
  }
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return s;
  const ap = hh < 12 ? "am" : "pm";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, "0")}${ap}`;
}

export const COMPANY_ID = process.env.NEXT_PUBLIC_DEFAULT_COMPANY_ID!;
