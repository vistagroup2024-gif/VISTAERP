import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cronDenied } from "@/lib/cronAuth";

export const dynamic = "force-dynamic";

// Car Sales monthly job: generate the Monthly Service Charges due up to the
// current month for every Vista-owned vehicle, then post any not-yet-posted
// car events to the general ledger. Both steps are idempotent, so re-running is
// safe. Wire to Vercel Cron (see vercel.json) or an external pinger.
// Requires CRON_SECRET: pass ?secret= or a Bearer token.
async function run() {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("car_monthly_run");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, result: data });
}

export async function GET(req: Request) {
  const denied = cronDenied(req);
  if (denied) return denied;
  return run();
}

export const POST = GET;
