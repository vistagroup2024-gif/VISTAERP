import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser, getStaffAccess } from "@/lib/staffSession";
import { visibleCards, type CardAccess } from "@/lib/dashboardCards";

/**
 * TEMPORARY DIAGNOSTIC — preview only, never merged, never production.
 *
 * It replays the /dashboard server path step by step and times each step. It
 * imports the same helpers the page imports and issues the same reads; it
 * writes nothing, changes nothing, and the real dashboard is untouched — this
 * is a separate URL that happens to do the same work.
 *
 * WHY THIS SHAPE. The earlier probe reported staff_access at 83.8 ms from the
 * function while the same routine measured inside Postgres takes 1.13 ms. Those
 * 82 ms are not query time, so they are either the HTTPS handshake to Supabase
 * or a fixed per-request cost — and which of the two it is decides everything
 * about where the second and a half of /dashboard goes. So staff_access is
 * called three times in a row here: the first pays for whatever setting up the
 * connection costs, the second and third do not. The gap between them is the
 * answer.
 *
 * Then the page's own reads, twice: once one after another so each can be
 * priced, and once all together exactly as the page issues them, which is the
 * figure that actually appears in a page render.
 *
 * Returns durations, region names and counts only — no session, no rows, no
 * keys — and refuses outright when VERCEL_ENV is production.
 *
 * Delete app/api/perf to remove all of it.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.VERCEL_ENV === "production") {
    return new NextResponse("Not found", { status: 404 });
  }

  const t0 = performance.now();
  const at = () => Math.round((performance.now() - t0) * 10) / 10;
  const since = (t: number) => Math.round((performance.now() - t) * 10) / 10;

  const supabase = createClient();

  // The floor: one HTTPS request to Supabase with no query behind it, from this
  // function. Anything a real call costs above this is the call itself.
  const tPing = performance.now();
  let ping = -1;
  try {
    await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! },
      cache: "no-store",
    });
    ping = since(tPing);
  } catch { /* leave at -1 */ }

  // What the page does first. getSessionUser reads the cookie locally — it
  // should cost nothing, and if it does not, that is itself a finding.
  const tUser = performance.now();
  const user = await getSessionUser();
  const userMs = since(tUser);

  // staff_access three times: cold connection, then warm.
  const tA1 = performance.now(); await supabase.rpc("staff_access"); const staff1 = since(tA1);
  const tA2 = performance.now(); await supabase.rpc("staff_access"); const staff2 = since(tA2);
  const tA3 = performance.now(); await supabase.rpc("staff_access"); const staff3 = since(tA3);

  // The React-cached one the layout and page actually share.
  const tAccess = performance.now();
  const access = await getStaffAccess();
  const accessMs = since(tAccess);

  // Pure CPU, no network — how much of a page is its own arithmetic.
  const tCards = performance.now();
  const cards = visibleCards(access.dashboardCards as CardAccess);
  const cardsMs = since(tCards);

  // The page's three reads, priced one at a time.
  const tP = performance.now();
  await supabase.from("profiles").select("company_id").eq("id", user?.id ?? "").maybeSingle();
  const profileMs = since(tP);
  const tM = performance.now(); await supabase.rpc("dashboard_metrics"); const metricsMs = since(tM);
  const tMM = performance.now(); await supabase.rpc("dashboard_module_metrics"); const moduleMs = since(tMM);

  // And again the way the page issues them — together. This is the number that
  // shows up in a real render; the three above only say what each contributes.
  const tPar = performance.now();
  await Promise.all([
    supabase.from("profiles").select("company_id").eq("id", user?.id ?? "").maybeSingle(),
    supabase.rpc("dashboard_metrics"),
    supabase.rpc("dashboard_module_metrics"),
  ]);
  const parallelMs = since(tPar);

  const total = at();

  const timings = {
    bare_https_to_supabase: ping,
    getSessionUser_local_cookie: userMs,
    staff_access_1st_cold_connection: staff1,
    staff_access_2nd_warm: staff2,
    staff_access_3rd_warm: staff3,
    getStaffAccess_react_cached: accessMs,
    visibleCards_cpu_only: cardsMs,
    profiles_query: profileMs,
    dashboard_metrics: metricsMs,
    dashboard_module_metrics: moduleMs,
    all_three_in_parallel_as_the_page_runs_them: parallelMs,
    total_route: total,
  };

  return NextResponse.json({
    what: "replays the /dashboard server path, timing each step",
    function_region: process.env.VERCEL_REGION ?? "unknown",
    supabase_region: "ap-southeast-2 (Sydney)",
    signed_in: !!user,
    cards_visible: cards.length,
    timings_ms: timings,
    read_this_way: {
      connection_setup_cost: "staff_access_1st minus staff_access_2nd",
      per_call_overhead_floor: "bare_https_to_supabase",
      what_a_real_render_pays: "getStaffAccess + all_three_in_parallel",
      caveat: "Run 3+ times. A cold function instance pays the handshake again.",
    },
  }, {
    headers: {
      "Server-Timing": [
        `ping;desc="bare https to supabase";dur=${ping}`,
        `user;desc="getSessionUser (local)";dur=${userMs}`,
        `staff_cold;desc="staff_access 1st";dur=${staff1}`,
        `staff_warm;desc="staff_access 2nd";dur=${staff2}`,
        `access;desc="getStaffAccess";dur=${accessMs}`,
        `cards;desc="visibleCards cpu";dur=${cardsMs}`,
        `q_profiles;desc="profiles";dur=${profileMs}`,
        `q_metrics;desc="dashboard_metrics";dur=${metricsMs}`,
        `q_module;desc="dashboard_module_metrics";dur=${moduleMs}`,
        `q_parallel;desc="all three together";dur=${parallelMs}`,
        `total;desc="total route";dur=${total}`,
      ].join(", "),
      "Cache-Control": "no-store",
    },
  });
}
