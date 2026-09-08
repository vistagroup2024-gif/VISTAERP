import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cronDenied } from "@/lib/cronAuth";

export const dynamic = "force-dynamic";

// Car Sales monthly job: generate the Monthly Service Charges due up to the
// current month for every Vista-owned vehicle, then post any not-yet-posted
// car events to the general ledger. Both steps are idempotent, so re-running is
// safe. Wire to Vercel Cron (see vercel.json) or an external pinger.
// Requires CRON_SECRET: pass ?secret= or a Bearer token. The same secret is
// passed THROUGH to the routine, because this route calls the database with the
// ordinary client and a scheduler has no Supabase session — so the call is made
// as `anon`, and the routine has to be reachable by anon to work at all. The
// secret is what stands in front of it; without being handed on, the route's
// own check could simply be stepped around by calling the RPC directly with the
// anon key, which ships in the browser bundle.
async function run() {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("car_monthly_run", { p_secret: process.env.CRON_SECRET });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, result: data });
}

export async function GET(req: Request) {
  const denied = cronDenied(req);
  if (denied) return denied;
  return run();
}

export const POST = GET;
