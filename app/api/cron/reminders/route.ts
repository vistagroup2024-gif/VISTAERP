import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cronDenied } from "@/lib/cronAuth";

export const dynamic = "force-dynamic";

// Hotel-details reminder job. It wants to run roughly HOURLY — the reminders it
// raises are 48h / 24h / 12h before arrival, so a daily sweep will miss the
// tighter ones. vercel.json can only ask for daily: the account is on Hobby,
// where a cron may fire once a day, and an hourly expression there is not a
// slower job but a REJECTED DEPLOYMENT — the push that first added one never
// built at all. For true hourly, either move the project to Pro and set
// "0 * * * *", or point an external pinger at this URL with ?secret=CRON_SECRET.
//
// It scans upcoming arrivals for Non Masar / Masar groups still missing Hotel
// Details and generates the 48h / 24h / 12h agent reminders plus the 24h admin
// escalation (deduped in DB).
// Requires CRON_SECRET: pass ?secret= or a Bearer token.
// Each routine is handed CRON_SECRET as well: this route calls the database as
// `anon` (a scheduler has no session), so the routines must be anon-reachable,
// and the secret is what stands in front of them. See the car-sales route.
async function run() {
  const supabase = createClient();
  const secret = process.env.CRON_SECRET;
  const { data, error } = await supabase.rpc("generate_hotel_reminders", { p_secret: secret });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  // Tafweej reminders (~6h before Jeddah-airport Umrah arrivals).
  const { data: tafweej, error: tErr } = await supabase.rpc("generate_tafweej_reminders", { p_secret: secret });
  if (tErr) return NextResponse.json({ ok: false, error: tErr.message }, { status: 500 });
  // Hotel HCN reminders (48h / 24h / check-in-day when the HCN is still not received).
  const { data: hotelHcn, error: hErr } = await supabase.rpc("generate_hotel_hcn_reminders", { p_secret: secret });
  if (hErr) return NextResponse.json({ ok: false, error: hErr.message }, { status: 500 });
  // Refresh cached BRN readiness (Ready to Allocate / Waiting BRN) for in-flight
  // groups, so labels stay current as shared inventory is consumed. The function
  // carries its own high statement_timeout, so it completes off the request path.
  const { error: aErr } = await supabase.rpc("refresh_brn_availability", { p_secret: secret });
  return NextResponse.json({ ok: true, created: data ?? 0, tafweej: tafweej ?? 0, hotelHcn: hotelHcn ?? 0, availability: aErr ? aErr.message : "refreshed" });
}

export async function GET(req: Request) {
  const denied = cronDenied(req);
  if (denied) return denied;
  return run();
}

export const POST = GET;
