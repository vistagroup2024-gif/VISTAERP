import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Hotel-details reminder job. Wire this to a scheduler (Vercel Cron or an
// external uptime pinger) to run roughly hourly. It scans upcoming arrivals for
// Non Masar / Masar groups still missing Hotel Details and generates the
// 48h / 24h / 12h agent reminders plus the 24h admin escalation (deduped in DB).
// If CRON_SECRET is set, requests must pass ?secret= or a Bearer token.
async function run() {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("generate_hotel_reminders");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  // Tafweej reminders (~6h before Jeddah-airport Umrah arrivals).
  const { data: tafweej, error: tErr } = await supabase.rpc("generate_tafweej_reminders");
  if (tErr) return NextResponse.json({ ok: false, error: tErr.message }, { status: 500 });
  // Refresh cached BRN readiness (Ready to Allocate / Waiting BRN) for in-flight
  // groups, so labels stay current as shared inventory is consumed. The function
  // carries its own high statement_timeout, so it completes off the request path.
  const { error: aErr } = await supabase.rpc("refresh_brn_availability");
  return NextResponse.json({ ok: true, created: data ?? 0, tafweej: tafweej ?? 0, availability: aErr ? aErr.message : "refreshed" });
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
