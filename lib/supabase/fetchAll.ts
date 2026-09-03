import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Read EVERY row of a query, in pages.
 *
 * PostgREST caps a response at 1000 rows and does it silently — no error, no
 * flag, just a short array. Any screen that loads a whole table and does its
 * own arithmetic is therefore correct only until that table passes 1000 rows,
 * and then quietly starts lying. brn_consumption crossed 1000 and the Daily
 * Calendar began showing a BRN's full 12 beds as free because the row that
 * consumed 7 of them was #1010.
 *
 * Pass a factory that applies `.range(from, to)` to the query:
 *
 *   const { data, error } = await fetchAllRows<Consumption>((from, to) =>
 *     supabase.from("brn_consumption").select("*").range(from, to));
 *
 * Pages are requested until one comes back short, so the cost is one extra
 * round trip per full page — two calls for a table of this size.
 */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
  pageSize = 1000,
): Promise<{ data: T[]; error: PostgrestError | null }> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) return { data: all, error };
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) return { data: all, error: null };
  }
}
