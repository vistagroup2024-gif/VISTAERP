/**
 * The ERP runs on Saudi time (Asia/Riyadh, UTC+3, no daylight saving).
 *
 * `new Date().toISOString().slice(0, 10)` gives the UTC date, which is the
 * PREVIOUS day for the first three hours of every Saudi day. A voucher dated
 * that way is dated yesterday, and a report asked for "today" covers the wrong
 * one. The database now runs in Asia/Riyadh too (migration 311), so these
 * helpers are what keeps the browser agreeing with it.
 *
 * Intl is used rather than an offset constant so the answer stays right if the
 * zone's rules ever change; Saudi Arabia has no daylight saving today, but
 * hard-coding +03 is the kind of thing nobody revisits.
 */
export const SA_TZ = "Asia/Riyadh";

const ymd = new Intl.DateTimeFormat("en-CA", {
  timeZone: SA_TZ, year: "numeric", month: "2-digit", day: "2-digit",
});
const hm = new Intl.DateTimeFormat("en-GB", {
  timeZone: SA_TZ, hour: "2-digit", minute: "2-digit", hour12: false,
});

/** Today in Saudi Arabia as YYYY-MM-DD — what a date input expects. */
export function todaySA(d: Date = new Date()): string {
  return ymd.format(d);              // en-CA formats as YYYY-MM-DD
}

/** The time now in Saudi Arabia as HH:MM (24h). */
export function timeNowSA(d: Date = new Date()): string {
  return hm.format(d);
}

/** Any instant as the Saudi calendar date, e.g. for grouping a timestamp by day. */
export function toSADate(value: string | number | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? "" : ymd.format(d);
}

/** Saudi date N days from today, as YYYY-MM-DD. */
export function addDaysSA(days: number, from: Date = new Date()): string {
  return todaySA(new Date(from.getTime() + days * 86400000));
}

/** The first day of the current Saudi month, as YYYY-MM-DD. */
export function monthStartSA(d: Date = new Date()): string {
  return todaySA(d).slice(0, 8) + "01";
}

/** The current Saudi year, as a number. */
export function yearSA(d: Date = new Date()): number {
  return Number(todaySA(d).slice(0, 4));
}
