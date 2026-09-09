import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * MEASUREMENT PROBE — preview only, never merged, never production.
 *
 * The other half of the picture. This one runs in the SERVERLESS runtime, in
 * syd1, where the pages render — so it is co-located with Supabase and its
 * numbers are the cost of the work itself with almost no distance in them.
 *
 * It runs the same staff_access the pages run through guardStaffPage, then the
 * actual queries behind the six screens being measured. Nothing is written and
 * nothing existing is touched: these are the same reads those pages already do,
 * under the caller's own session and RLS.
 *
 * Subtracting these from what the browser sees is what isolates the distance.
 */
export const dynamic = "force-dynamic";

const COMPANY = "96f6b539-b491-4df7-91a2-80c7c8e7491d";

export async function GET() {
  if (process.env.VERCEL_ENV === "production") {
    return new NextResponse("Not found", { status: 404 });
  }

  const supabase = createClient();
  const t0 = performance.now();
  const ms = (t: number) => Math.round((performance.now() - t) * 10) / 10;

  async function time(label: string, run: () => PromiseLike<unknown>) {
    const t = performance.now();
    let ok = true;
    try { await Promise.resolve(run()); } catch { ok = false; }
    return [label, ms(t), ok] as const;
  }

  // What every page pays before it renders anything.
  const tStaff = performance.now();
  const { data: access } = await supabase.rpc("staff_access");
  const staffMs = ms(tStaff);

  // The real queries behind the six screens.
  const perPage = await Promise.all([
    time("dashboard: dashboard_metrics", () => supabase.rpc("dashboard_metrics")),
    time("dashboard: dashboard_module_metrics", () => supabase.rpc("dashboard_module_metrics")),
    time("chart of accounts: acct_tree", () => supabase.rpc("acct_tree", { p_company: COMPANY })),
    time("groups: umrah_groups page", () => supabase.from("umrah_groups").select("id").order("id").range(0, 999)),
    time("audit: acct_audit 200", () => supabase.from("acct_audit").select("*").limit(200)),
    time("ledger: accounts list", () => supabase.from("accounts").select("id, code, name, subtype, type").eq("status", "active")),
    time("transport ops: trips", () => supabase.from("transport_trips").select("id").limit(200)),
  ]);

  const total = ms(t0);

  return NextResponse.json({
    where: "serverless function (where pages render)",
    function_region: process.env.VERCEL_REGION ?? "unknown",
    supabase_region: "ap-southeast-2 (Sydney)",
    signed_in: !!access,
    timings_ms: {
      page_staff_access: staffMs,
      queries: Object.fromEntries(perPage.map(([l, d]) => [l, d])),
      queries_ran_in_parallel_total: total - staffMs,
      total_node_work: total,
    },
    notes: {
      failed: perPage.filter(([, , ok]) => !ok).map(([l]) => l),
      caveat: "Queries run in parallel here, as the pages run them. Per-query figures overlap.",
    },
  }, {
    headers: {
      "Server-Timing": [
        `page_staff;desc="staff_access in the function";dur=${staffMs}`,
        `db;desc="page queries (parallel)";dur=${total - staffMs}`,
        `node_total;desc="total function work";dur=${total}`,
      ].join(", "),
      "Cache-Control": "no-store",
    },
  });
}
