import type { ToolResult } from "@/lib/ai/types";

// Small helpers every tool shares. The point of `cap` is requirement §38:
// the assistant is given the rows it needs to answer, not the table. A
// truncated set always says so, so the model can tell the user "showing the
// top 20 of 63" instead of quietly answering from a partial list.

export const MAX_ROWS = 40;

export function ok(data: unknown, opts?: { count?: number; summary?: string; link?: string }): ToolResult {
  return { ok: true, data, count: opts?.count, summary: opts?.summary, link: opts?.link };
}

export function fail(error: string): ToolResult {
  return { ok: false, error };
}

/** Postgrest errors reach the user as themselves — never as a made-up answer. */
export function fromError(e: { message?: string } | null | undefined, fallback: string): ToolResult {
  return fail(e?.message || fallback);
}

export function cap<T>(rows: T[], limit = MAX_ROWS): { rows: T[]; total: number; truncated: boolean } {
  return { rows: rows.slice(0, limit), total: rows.length, truncated: rows.length > limit };
}

export function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Today in the Riyadh business day, as YYYY-MM-DD. */
export function today(): string {
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
