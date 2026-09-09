import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * MEASUREMENT PROBE — preview only, never merged, never production.
 *
 * It changes nothing. It does not touch middleware, staff_access, RLS or any
 * page; it simply makes the SAME two Supabase calls the middleware makes, from
 * the SAME runtime the middleware runs in (edge, at the PoP nearest whoever
 * opens it), and reports how long each one took.
 *
 * That is the question: an edge node near Riyadh talking to Supabase in Sydney.
 * It has to be opened from Riyadh to mean anything — measuring it from anywhere
 * else measures that other place's distance to Sydney.
 *
 * Returns durations, region names and booleans only. No session data, no row
 * data, no keys.
 */
export const runtime = "edge";
export const dynamic = "force-dynamic";

const ms = (t: number) => Math.round((performance.now() - t) * 10) / 10;

export async function GET() {
  // Never reachable on production, whatever else happens.
  if (process.env.VERCEL_ENV === "production") {
    return new NextResponse("Not found", { status: 404 });
  }

  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  );

  const t0 = performance.now();

  // 1. A bare HTTPS round trip to Supabase with no query behind it: connection
  //    + TLS + one request. This is the floor — the distance itself.
  const tPing = performance.now();
  let pingStatus = 0;
  try {
    const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! },
      cache: "no-store",
    });
    pingStatus = r.status;
  } catch { pingStatus = -1; }
  const ping = ms(tPing);

  // 2. The middleware's first call.
  const tAuth = performance.now();
  const { data: { user } } = await supabase.auth.getUser();
  const authMs = ms(tAuth);

  // 3. The middleware's second call.
  const tStaff = performance.now();
  const { error: staffErr } = await supabase.rpc("staff_access");
  const staffMs = ms(tStaff);

  const total = ms(t0);

  const body = {
    where: "edge (nearest PoP to you)",
    edge_region: process.env.VERCEL_REGION ?? "unknown",
    supabase_region: "ap-southeast-2 (Sydney)",
    signed_in: !!user,
    timings_ms: {
      bare_https_round_trip: ping,
      auth_getUser: authMs,
      staff_access: staffMs,
      total_edge_work: total,
    },
    notes: {
      ping_status: pingStatus,
      staff_access_error: staffErr ? "yes" : "no",
      caveat: "Open this from Riyadh. Run it 3+ times — the first includes TLS setup.",
    },
  };

  return NextResponse.json(body, {
    headers: {
      "Server-Timing": [
        `ping;desc="bare https round trip";dur=${ping}`,
        `mw_auth;desc="auth.getUser";dur=${authMs}`,
        `mw_staff;desc="staff_access";dur=${staffMs}`,
        `edge_total;desc="total edge work";dur=${total}`,
      ].join(", "),
      "Cache-Control": "no-store",
    },
  });
}
