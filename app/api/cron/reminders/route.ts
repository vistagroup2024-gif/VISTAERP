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
  return NextResponse.json({ ok: true, created: data ?? 0 });
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
