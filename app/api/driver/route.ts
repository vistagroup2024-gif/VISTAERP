import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const token = cookies().get("driver_session")?.value;
  if (!token) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const sb = createClient();

  if (body.action === "status") {
    const { error } = await sb.rpc("transport_driver_portal_status", { p_token: token, p_trip: body.trip_id, p_status: body.status });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  // default: list (me + trips for a date)
  const me = await sb.rpc("transport_me", { p_token: token });
  if (me.error || !me.data) return NextResponse.json({ error: "Session expired" }, { status: 401 });
  const trips = await sb.rpc("transport_driver_my_trips", { p_token: token, p_date: body.date ?? null });
  return NextResponse.json({ driver: me.data, trips: trips.data ?? [] });
}
