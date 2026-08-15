import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Car Sales monthly job: generate the Monthly Service Charges due up to the
// current month for every Vista-owned vehicle, then post any not-yet-posted
// car events to the general ledger. Both steps are idempotent, so re-running is
// safe. Wire to Vercel Cron (see vercel.json) or an external pinger.
// If CRON_SECRET is set, requests must pass ?secret= or a Bearer token.
async function run() {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("car_monthly_run");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, result: data });
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const url = new URL(req.url);
    const provided = url.searchParams.get("secret") || (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (provided !== secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return run();
}

export const POST = GET;
